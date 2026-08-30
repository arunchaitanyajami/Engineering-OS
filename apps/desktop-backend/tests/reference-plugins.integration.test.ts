import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApplicationDatabase } from "@engineering-os/database";
import { createLogger } from "@engineering-os/logger";
import { McpGatewayService } from "@engineering-os/mcp-gateway";
import {
  PluginRegistryService,
  SqlitePluginRegistryRepository
} from "@engineering-os/plugin-registry";
import { PluginRuntimeService } from "@engineering-os/plugin-runtime";
import {
  PermissionEngineService,
  SqlitePermissionGrantRepository
} from "@engineering-os/permission-engine";
import {
  EncryptedFileSecretStore,
  SecretService
} from "@engineering-os/security/server";

import { PluginLifecycleService } from "../src/plugin-lifecycle-service.js";

const projectRootPath = fileURLToPath(new URL("../../..", import.meta.url));
const examplePluginPath = join(projectRootPath, "plugins/example-plugin");
const exampleMcpPluginPath = join(
  projectRootPath,
  "plugins/example-mcp-plugin"
);

describe("Reference plugins", () => {
  const databases: ApplicationDatabase[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    databases.forEach((database) => database.close());
    databases.length = 0;

    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
    directories.length = 0;
  });

  const createServices = async () => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-reference-plugins-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);

    const installationsRootPath = join(fixturesDirectory, "managed-plugins");
    const pluginRegistry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "reference-plugins-test" }),
      engineeringOsVersion: "0.2.0",
      installationsRootPath
    });
    const workerWrapperPath = join(
      fixturesDirectory,
      "plugin-runtime-worker-wrapper.ts"
    );

    await writeFile(
      workerWrapperPath,
      `
        import { runPluginRuntimeWorker } from ${JSON.stringify(
          fileURLToPath(
            new URL(
              "../../../packages/plugin-runtime/src/worker.ts",
              import.meta.url
            )
          )
        )};

        runPluginRuntimeWorker();
      `,
      "utf8"
    );

    const permissionEngine = new PermissionEngineService({
      installedPlugins: pluginRegistry,
      repository: new SqlitePermissionGrantRepository(database),
      logger: createLogger({ component: "reference-plugins-test" })
    });
    const secretStore = new SecretService(
      await EncryptedFileSecretStore.open(join(fixturesDirectory, "secrets"))
    );
    const pluginRuntime = new PluginRuntimeService({
      pluginResolver: pluginRegistry,
      logger: createLogger({ component: "reference-plugins-test" }),
      worker: {
        entryPointPath: workerWrapperPath,
        execArgv: ["--import", "tsx"],
        cwd: projectRootPath
      },
      restartBackoffMs: 50,
      permissionBroker: {
        checkPermission: (input) =>
          permissionEngine.checkPluginPermission(input),
        requestPermission: (input) =>
          permissionEngine.requestPluginPermission(input)
      },
      configurationBroker: {
        getConfiguration: () => null
      },
      secretStore
    });
    const mcpGateway = new McpGatewayService({
      installedPlugins: pluginRegistry,
      logger: createLogger({ component: "reference-plugins-test" }),
      startupTimeoutMs: 2_000,
      startupStabilityPeriodMs: 50
    });
    const pluginLifecycle = new PluginLifecycleService({
      pluginRegistry,
      pluginRuntime,
      mcpGateway,
      permissionEngine,
      secretStore
    });

    const grantAllPermissions = (pluginId: string) => {
      const review = permissionEngine.getPermissionReview(pluginId);

      if (review.pendingRequirements.length === 0) {
        return;
      }

      permissionEngine.grantPermissions({
        pluginId,
        grants: review.pendingRequirements.map((requirement) => ({
          scope: requirement.scope,
          decision: "always-allow" as const,
          ...(requirement.constraint
            ? { constraint: requirement.constraint }
            : {})
        }))
      });
    };

    return {
      mcpGateway,
      pluginRegistry,
      pluginRuntime,
      pluginLifecycle,
      grantAllPermissions
    };
  };

  it("installs and runs the bundled example plugin", async () => {
    const {
      pluginRegistry,
      pluginRuntime,
      pluginLifecycle,
      grantAllPermissions
    } = await createServices();

    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(examplePluginPath);

    expect(installedPlugin.pluginId).toBe("com.engineering-os.example");

    grantAllPermissions(installedPlugin.pluginId);
    await pluginLifecycle.enablePlugin(installedPlugin.pluginId);
    await pluginLifecycle.startPlugin(installedPlugin.pluginId);

    expect(
      pluginRuntime.getRuntimeHealth(installedPlugin.pluginId)
    ).toMatchObject({
      status: "running",
      healthy: true
    });

    await pluginLifecycle.stopPlugin(installedPlugin.pluginId);
  });

  it("discovers and executes tools from the bundled example MCP plugin", async () => {
    const { mcpGateway, pluginRegistry, pluginLifecycle, grantAllPermissions } =
      await createServices();

    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(exampleMcpPluginPath);
    const registrationId = "com.engineering-os.example-mcp:example";

    grantAllPermissions(installedPlugin.pluginId);
    await pluginLifecycle.enablePlugin(installedPlugin.pluginId);
    await pluginLifecycle.startPluginMcpServer(
      installedPlugin.pluginId,
      registrationId
    );

    const capabilities = mcpGateway.getCatalog({
      pluginId: installedPlugin.pluginId,
      serverId: "example"
    });

    expect(capabilities.tools.map((tool) => tool.name)).toEqual([
      "echo",
      "get_current_workspace_info",
      "list_sample_resources",
      "read_sample_resource"
    ]);
    expect(capabilities.resources.length).toBeGreaterThan(0);

    const echoToolId = capabilities.tools.find(
      (tool) => tool.name === "echo"
    )?.id;
    expect(echoToolId).toBeTruthy();

    await expect(
      mcpGateway.executeTool({
        toolId: echoToolId!,
        arguments: {
          message: "hello from reference plugin"
        },
        executionContext: {
          actor: {
            type: "user"
          },
          correlationId: "reference-plugin-echo",
          approvalMode: "none"
        }
      })
    ).resolves.toMatchObject({
      status: "success",
      content: [
        {
          type: "text",
          text: "hello from reference plugin"
        }
      ]
    });

    await pluginLifecycle.disablePlugin(installedPlugin.pluginId);

    expect(
      pluginRegistry.getInstalledPlugin(installedPlugin.pluginId)?.enabled
    ).toBe(false);
    expect(mcpGateway.inspectServerHealth(registrationId).healthState).not.toBe(
      "healthy"
    );
    await expect(
      mcpGateway.executeTool({
        toolId: echoToolId!,
        arguments: {
          message: "should fail after disable"
        },
        executionContext: {
          actor: {
            type: "user"
          },
          correlationId: "reference-plugin-disabled",
          approvalMode: "none"
        }
      })
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^MCP_GATEWAY/)
    });
  });
});
