import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLogger } from "@engineering-os/logger";
import { ApplicationDatabase } from "@engineering-os/database";
import {
  PluginRegistryService,
  SqlitePluginRegistryRepository
} from "@engineering-os/plugin-registry";

import {
  PermissionEngineService,
  SqliteAuditRepository,
  SqlitePermissionGrantRepository
} from "../src/index.js";

describe("PermissionEngineService", () => {
  const directories: string[] = [];
  const databases: ApplicationDatabase[] = [];

  afterEach(async () => {
    for (const database of databases.splice(0)) {
      database.close();
    }

    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
    directories.length = 0;
  });

  const createEngine = async (
    manifestPermissions: readonly Record<string, unknown>[] = []
  ) => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-permission-engine-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);

    const pluginRegistry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "permission-engine-test" }),
      engineeringOsVersion: "0.2.0",
      installationsRootPath: join(fixturesDirectory, "managed-plugins")
    });

    const packageDirectory = await mkdtemp(
      join(fixturesDirectory, "plugin-package-")
    );
    const manifest = {
      schemaVersion: "1",
      id: "com.engineering-os.permission-test",
      name: "Permission Test Plugin",
      version: "0.1.0",
      description: "Plugin package for permission engine tests.",
      publisher: { name: "Engineering OS" },
      engines: { engineeringOs: ">=0.1.0" },
      entrypoints: { backend: "./dist/backend/index.js" },
      capabilities: manifestPermissions.length > 0 ? ["mcp-server"] : [],
      permissions: manifestPermissions,
      mcp: []
    };

    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(packageDirectory, "dist/backend"), { recursive: true });
    await writeFile(
      join(packageDirectory, "engineering-os.plugin.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
    await writeFile(
      join(packageDirectory, "dist/backend/index.js"),
      `export default { manifest: ${JSON.stringify(manifest)}, async initialize(){}, async activate(){}, async deactivate(){}, async dispose(){} };`,
      "utf8"
    );

    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(packageDirectory);

    const permissionEngine = new PermissionEngineService({
      installedPlugins: pluginRegistry,
      repository: new SqlitePermissionGrantRepository(database),
      logger: createLogger({ component: "permission-engine-test" })
    });

    return {
      installedPlugin,
      permissionEngine
    };
  };

  it("allows enabling plugins with no declared permissions", async () => {
    const { installedPlugin, permissionEngine } = await createEngine();

    expect(
      permissionEngine.getPermissionReview(installedPlugin.pluginId)
    ).toMatchObject({
      canEnable: true,
      pendingRequirements: []
    });

    expect(() =>
      permissionEngine.assertCanEnablePlugin(installedPlugin.pluginId)
    ).not.toThrow();
  });

  it("blocks enablement until declared permissions are granted", async () => {
    const { installedPlugin, permissionEngine } = await createEngine([
      {
        scope: "process.spawn",
        reason: "Launches bundled MCP servers for permission tests."
      },
      {
        scope: "mcp.register-server",
        reason: "Registers bundled MCP servers for permission tests."
      }
    ]);

    expect(
      permissionEngine.getPermissionReview(installedPlugin.pluginId)
    ).toMatchObject({
      canEnable: false,
      pendingRequirements: [
        { scope: "process.spawn" },
        { scope: "mcp.register-server" }
      ]
    });

    expect(() =>
      permissionEngine.assertCanEnablePlugin(installedPlugin.pluginId)
    ).toThrow(/cannot be enabled until all declared permissions are granted/);

    permissionEngine.grantPermissions({
      pluginId: installedPlugin.pluginId,
      grants: [
        { scope: "process.spawn", decision: "always-allow" },
        { scope: "mcp.register-server", decision: "always-allow" }
      ]
    });

    expect(
      permissionEngine.getPermissionReview(installedPlugin.pluginId)
    ).toMatchObject({
      canEnable: true
    });
  });

  it("revokes permission grants immediately", async () => {
    const { installedPlugin, permissionEngine } = await createEngine([
      {
        scope: "tool.execute",
        reason: "Executes MCP tools declared by the permission test plugin."
      }
    ]);

    permissionEngine.grantPermissions({
      pluginId: installedPlugin.pluginId,
      grants: [{ scope: "tool.execute", decision: "always-allow" }]
    });

    permissionEngine.revokePermission(installedPlugin.pluginId, "tool.execute");

    expect(
      permissionEngine.hasActiveGrant(installedPlugin.pluginId, "tool.execute")
    ).toBe(false);
  });

  it("requires explicit approval for unknown-risk tool execution", () => {
    const database = new ApplicationDatabase(":memory:");
    databases.push(database);
    database.runMigrations();

    const permissionEngine = new PermissionEngineService({
      installedPlugins: {
        getInstalledPlugin: () => null
      },
      repository: new SqlitePermissionGrantRepository(database),
      logger: createLogger({ component: "permission-engine-test" })
    });

    expect(
      permissionEngine.evaluateToolExecution({
        tool: {
          id: "user.test.tool.unknown",
          serverId: "test",
          name: "unknown",
          inputSchema: { type: "object" },
          riskLevel: "unknown"
        },
        executionContext: {
          actor: { type: "agent", id: "architect" },
          correlationId: "corr-permission",
          approvalMode: "none"
        }
      })
    ).toMatchObject({
      allowed: false,
      code: "MCP_TOOL_EXECUTION_APPROVAL_REQUIRED"
    });

    expect(
      permissionEngine.evaluateToolExecution({
        tool: {
          id: "user.test.tool.unknown",
          serverId: "test",
          name: "unknown",
          inputSchema: { type: "object" },
          riskLevel: "unknown"
        },
        executionContext: {
          actor: { type: "agent", id: "architect" },
          correlationId: "corr-permission",
          approvalMode: "user-confirmation"
        }
      })
    ).toMatchObject({
      allowed: true
    });
  });

  it("requires plugin tool.execute grant for plugin-owned tools", async () => {
    const { installedPlugin, permissionEngine } = await createEngine([
      {
        scope: "tool.execute",
        reason: "Executes MCP tools declared by the permission test plugin."
      }
    ]);

    expect(
      permissionEngine.evaluateToolExecution({
        tool: {
          id: "com.engineering-os.permission-test.tool.read",
          serverId: "filesystem",
          pluginId: installedPlugin.pluginId,
          name: "read",
          inputSchema: { type: "object" },
          riskLevel: "read-only"
        },
        executionContext: {
          actor: { type: "agent", id: "architect" },
          correlationId: "corr-permission",
          approvalMode: "none"
        }
      })
    ).toMatchObject({
      allowed: false,
      code: "PLUGIN_TOOL_EXECUTE_PERMISSION_DENIED"
    });

    permissionEngine.grantPermissions({
      pluginId: installedPlugin.pluginId,
      grants: [{ scope: "tool.execute", decision: "always-allow" }]
    });

    expect(
      permissionEngine.evaluateToolExecution({
        tool: {
          id: "com.engineering-os.permission-test.tool.read",
          serverId: "filesystem",
          pluginId: installedPlugin.pluginId,
          name: "read",
          inputSchema: { type: "object" },
          riskLevel: "read-only"
        },
        executionContext: {
          actor: { type: "agent", id: "architect" },
          correlationId: "corr-permission",
          approvalMode: "none"
        }
      })
    ).toMatchObject({
      allowed: true
    });
  });

  it("consumes allow-once grants after successful tool execution audit flow", async () => {
    const { installedPlugin, permissionEngine } = await createEngine([
      {
        scope: "tool.execute",
        reason: "Executes MCP tools declared by the permission test plugin."
      }
    ]);

    permissionEngine.grantPermissions({
      pluginId: installedPlugin.pluginId,
      grants: [{ scope: "tool.execute", decision: "allow-once" }]
    });

    expect(
      permissionEngine.hasActiveGrant(installedPlugin.pluginId, "tool.execute")
    ).toBe(true);

    permissionEngine.consumeAllowOnceGrant(
      installedPlugin.pluginId,
      "tool.execute"
    );

    expect(
      permissionEngine.hasActiveGrant(installedPlugin.pluginId, "tool.execute")
    ).toBe(false);
  });

  it("records audit events for permission grants", async () => {
    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);

    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-permission-audit-")
    );
    directories.push(fixturesDirectory);

    const pluginRegistry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "permission-engine-test" }),
      engineeringOsVersion: "0.2.0",
      installationsRootPath: join(fixturesDirectory, "managed-plugins")
    });

    const packageDirectory = await mkdtemp(
      join(fixturesDirectory, "plugin-package-")
    );
    const manifest = {
      schemaVersion: "1",
      id: "com.engineering-os.permission-audit",
      name: "Permission Audit Plugin",
      version: "0.1.0",
      description: "Plugin package for permission audit tests.",
      publisher: { name: "Engineering OS" },
      engines: { engineeringOs: ">=0.1.0" },
      entrypoints: { backend: "./dist/backend/index.js" },
      capabilities: ["mcp-server"],
      permissions: [
        {
          scope: "tool.execute",
          reason: "Executes MCP tools declared by the permission audit plugin."
        }
      ],
      mcp: []
    };

    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(packageDirectory, "dist/backend"), { recursive: true });
    await writeFile(
      join(packageDirectory, "engineering-os.plugin.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
    await writeFile(
      join(packageDirectory, "dist/backend/index.js"),
      `export default { manifest: ${JSON.stringify(manifest)}, async initialize(){}, async activate(){}, async deactivate(){}, async dispose(){} };`,
      "utf8"
    );

    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(packageDirectory);
    const auditRepository = new SqliteAuditRepository(database);
    const permissionEngine = new PermissionEngineService({
      installedPlugins: pluginRegistry,
      repository: new SqlitePermissionGrantRepository(database),
      auditRepository,
      logger: createLogger({ component: "permission-engine-test" })
    });

    permissionEngine.grantPermissions({
      pluginId: installedPlugin.pluginId,
      grants: [{ scope: "tool.execute", decision: "always-allow" }]
    });

    expect(auditRepository.list({ limit: 1 })).toMatchObject([
      {
        action: "permission.granted",
        resourceId: installedPlugin.pluginId,
        outcome: "success"
      }
    ]);
  });
});
