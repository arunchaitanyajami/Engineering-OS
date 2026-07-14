import {
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createBackendContext,
  startDesktopBackendServer,
  type StartedDesktopBackendServer
} from "../src/server.js";

describe("desktop backend server", () => {
  const allowedOrigin = "http://127.0.0.1:1420";
  let appDataDirectory: string;
  let runtime: StartedDesktopBackendServer | null = null;

  const createLocalPluginPackage = async (
    rootDirectory: string,
    options: {
      readonly pluginId?: string;
      readonly engineeringOsRange?: string;
    } = {}
  ) => {
    const packageDirectory = await mkdtemp(join(rootDirectory, "plugin-package-"));
    const manifest = {
      schemaVersion: "1",
      id: options.pluginId ?? "com.engineering-os.filesystem",
      name: "Filesystem Plugin",
      version: "0.1.0",
      description: "Reference local plugin package for backend integration tests.",
      publisher: {
        name: "Engineering OS"
      },
      engines: {
        engineeringOs: options.engineeringOsRange ?? ">=0.1.0"
      },
      entrypoints: {
        backend: "./dist/backend/index.js"
      },
      capabilities: [],
      permissions: [],
      mcp: []
    };

    await mkdir(join(packageDirectory, "dist/backend"), { recursive: true });
    await writeFile(
      join(packageDirectory, "dist/backend/index.js"),
      `
        const manifest = ${JSON.stringify(manifest)};

        export default {
          manifest,
          async initialize() {},
          async activate() {},
          async deactivate() {},
          async dispose() {}
        };
      `,
      "utf8"
    );
    await writeFile(
      join(packageDirectory, "engineering-os.plugin.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );

    return packageDirectory;
  };

  const startRuntime = async () => {
    runtime = await startDesktopBackendServer({
      appDataDirectory,
      host: "127.0.0.1",
      port: 0,
      authToken: "integration-test-token",
      allowedOrigin
    });

    return runtime;
  };

  const authenticatedHeaders = (
    additionalHeaders: Record<string, string> = {}
  ) => ({
    authorization: `Bearer ${runtime?.authToken ?? "integration-test-token"}`,
    ...additionalHeaders
  });

  beforeEach(async () => {
    appDataDirectory = await mkdtemp(join(tmpdir(), "engineering-os-backend-"));
  });

  afterEach(async () => {
    if (runtime) {
      await runtime.close();
      runtime = null;
    }

    await rm(appDataDirectory, { recursive: true, force: true });
  });

  it("initializes local services through the native backend runtime", async () => {
    runtime = await startRuntime();

    const response = await fetch(`${runtime.baseUrl}/health`, {
      headers: authenticatedHeaders()
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      database: {
        ok: true,
        status: "ready",
        migrationVersion: 4,
        databasePath: runtime.context.databaseFilePath
      },
      configFilePath: runtime.context.configFilePath,
      logFilePath: runtime.context.logFilePath
    });
  });

  it("persists configuration updates atomically and preserves the prior version", async () => {
    runtime = await startRuntime();

    const originalConfig = JSON.stringify({
      schemaVersion: 1,
      settings: {
        theme: "light",
        telemetryEnabled: false,
        autoUpdateEnabled: true,
        minimizeToTray: false,
        launchOnStartup: false,
        developerMode: false
      }
    });
    const updatedConfig = JSON.stringify({
      schemaVersion: 1,
      settings: {
        theme: "dark",
        telemetryEnabled: true,
        autoUpdateEnabled: true,
        minimizeToTray: false,
        launchOnStartup: false,
        developerMode: true
      }
    });

    await fetch(`${runtime.baseUrl}/config`, {
      method: "PUT",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({ serializedConfig: originalConfig })
    });
    await fetch(`${runtime.baseUrl}/config`, {
      method: "PUT",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({ serializedConfig: updatedConfig })
    });

    const response = await fetch(`${runtime.baseUrl}/config`, {
      headers: authenticatedHeaders()
    });
    const body = (await response.json()) as {
      readonly serializedConfig: string | null;
    };

    expect(body.serializedConfig).toBe(updatedConfig);
    await expect(
      readFile(runtime.context.configFilePath, "utf8")
    ).resolves.toBe(updatedConfig);
    await expect(
      readFile(`${runtime.context.configFilePath}.bak`, "utf8")
    ).resolves.toBe(originalConfig);
  });

  it("round-trips sessions through the SQLite-backed HTTP contract", async () => {
    runtime = await startRuntime();

    const session = {
      id: "session-1",
      title: "Desktop Review",
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
      status: "active" as const
    };

    const createResponse = await fetch(`${runtime.baseUrl}/sessions`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({ session })
    });

    expect(createResponse.status).toBe(200);
    await expect(createResponse.json()).resolves.toEqual({ session });

    const listResponse = await fetch(`${runtime.baseUrl}/sessions`, {
      headers: authenticatedHeaders()
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      sessions: [session]
    });
  });

  it("writes persisted log entries to the local log file", async () => {
    runtime = await startRuntime();

    const entry = {
      timestamp: "2026-07-14T00:00:00.000Z",
      level: "info" as const,
      scope: "desktop-shell",
      message: "Desktop backend integration test.",
      context: {
        area: "native-integration"
      }
    };

    const response = await fetch(`${runtime.baseUrl}/logs`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({ entry })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    await expect(
      readFile(runtime.context.logFilePath, "utf8")
    ).resolves.toContain('"scope":"desktop-shell"');
  });

  it("requires authentication for desktop backend routes", async () => {
    runtime = await startRuntime();

    const response = await fetch(`${runtime.baseUrl}/health`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "BACKEND_AUTH_REQUIRED",
      message: "Desktop backend authentication is required."
    });
  });

  it("allows only the configured development origin to call the desktop backend", async () => {
    runtime = await startRuntime();

    const response = await fetch(`${runtime.baseUrl}/health`, {
      headers: {
        ...authenticatedHeaders(),
        origin: allowedOrigin
      }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      allowedOrigin
    );
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "OPTIONS"
    );
  });

  it("answers CORS preflight requests for allowed desktop origins", async () => {
    runtime = await startRuntime();

    const response = await fetch(`${runtime.baseUrl}/config`, {
      method: "OPTIONS",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "authorization, content-type"
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      allowedOrigin
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "authorization, content-type"
    );
  });

  it("enforces request size limits while streaming JSON bodies", async () => {
    runtime = await startRuntime();

    const oversizedConfig = JSON.stringify({
      serializedConfig: JSON.stringify({
        schemaVersion: 1,
        settings: {
          theme: "dark",
          telemetryEnabled: false,
          autoUpdateEnabled: true,
          minimizeToTray: false,
          launchOnStartup: false,
          developerMode: false,
          notes: "x".repeat(128 * 1024)
        }
      })
    });

    const response = await fetch(`${runtime.baseUrl}/config`, {
      method: "PUT",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: oversizedConfig
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      code: "REQUEST_PAYLOAD_TOO_LARGE",
      message: "Request payload exceeds the allowed size."
    });
  });

  it("recovers persisted configuration from a valid backup when the primary file is invalid", async () => {
    runtime = await startRuntime();

    const backupConfig = JSON.stringify({
      schemaVersion: 1,
      settings: {
        theme: "dark",
        telemetryEnabled: false,
        autoUpdateEnabled: true,
        minimizeToTray: false,
        launchOnStartup: false,
        developerMode: true
      }
    });

    await writeFile(runtime.context.configFilePath, "{invalid", "utf8");
    await writeFile(
      `${runtime.context.configFilePath}.bak`,
      backupConfig,
      "utf8"
    );

    const response = await fetch(`${runtime.baseUrl}/config`, {
      headers: authenticatedHeaders()
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      serializedConfig: backupConfig
    });
    await expect(
      readFile(runtime.context.configFilePath, "utf8")
    ).resolves.toBe(backupConfig);
  });

  it("restores the primary configuration when only the backup file exists", async () => {
    runtime = await startRuntime();

    const backupConfig = JSON.stringify({
      schemaVersion: 1,
      settings: {
        theme: "light",
        telemetryEnabled: false,
        autoUpdateEnabled: true,
        minimizeToTray: false,
        launchOnStartup: false,
        developerMode: false
      }
    });

    await unlink(runtime.context.configFilePath).catch(() => undefined);
    await writeFile(
      `${runtime.context.configFilePath}.bak`,
      backupConfig,
      "utf8"
    );

    const response = await fetch(`${runtime.baseUrl}/config`, {
      headers: authenticatedHeaders()
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      serializedConfig: backupConfig
    });
    await expect(
      readFile(runtime.context.configFilePath, "utf8")
    ).resolves.toBe(backupConfig);
  });

  it("runs migrations before exposing the backend context", async () => {
    const context = await createBackendContext(
      appDataDirectory,
      "integration-test-token",
      allowedOrigin
    );

    expect(context.database.getHealth()).toMatchObject({
      ok: true,
      migrationVersion: 4,
      databasePath: context.databaseFilePath
    });

    await context.flushLogs();
    context.database.close();
  });

  it("registers local plugin packages and lists installed plugins", async () => {
    runtime = await startRuntime();
    const packageDirectory = await createLocalPluginPackage(appDataDirectory);
    const resolvedPackageDirectory = await realpath(packageDirectory);
    const expectedInstallRootPath = join(
      appDataDirectory,
      "plugins",
      "com.engineering-os.filesystem",
      "0.1.0"
    );

    const registerResponse = await fetch(
      `${runtime.baseUrl}/plugins/register-local`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({ packagePath: packageDirectory })
      }
    );

    expect(registerResponse.status).toBe(200);
    await expect(registerResponse.json()).resolves.toMatchObject({
      plugin: {
        pluginId: "com.engineering-os.filesystem",
        installation: {
          mode: "managed",
          rootPath: expectedInstallRootPath,
          source: {
            type: "local-directory",
            path: resolvedPackageDirectory
          }
        },
        state: "installed",
        enabled: false
      }
    });

    const listResponse = await fetch(`${runtime.baseUrl}/plugins`, {
      headers: authenticatedHeaders()
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      plugins: [
        {
          pluginId: "com.engineering-os.filesystem",
          installation: {
            mode: "managed",
            rootPath: expectedInstallRootPath
          },
          state: "installed",
          enabled: false
        }
      ]
    });
  });

  it("rejects invalid register-local request payloads at runtime", async () => {
    runtime = await startRuntime();

    const response = await fetch(`${runtime.baseUrl}/plugins/register-local`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({ packagePath: 123 })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "PLUGIN_REGISTER_REQUEST_INVALID",
      message: "Plugin registration request is invalid."
    });
  });

  it("rejects incompatible plugin packages during registration", async () => {
    runtime = await startRuntime();
    const packageDirectory = await createLocalPluginPackage(appDataDirectory, {
      engineeringOsRange: ">=0.2.0"
    });

    const response = await fetch(`${runtime.baseUrl}/plugins/register-local`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({ packagePath: packageDirectory })
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "PLUGIN_VERSION_INCOMPATIBLE",
      message:
        "Plugin 'com.engineering-os.filesystem' requires Engineering OS '>=0.2.0' but current version is '0.1.0'."
    });
  });

  it("starts, inspects, and stops plugin runtimes through the backend API", async () => {
    runtime = await startRuntime();
    const packageDirectory = await createLocalPluginPackage(appDataDirectory, {
      pluginId: "com.engineering-os.runtime-test"
    });

    await fetch(`${runtime.baseUrl}/plugins/register-local`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({ packagePath: packageDirectory })
    });

    const enableResponse = await fetch(`${runtime.baseUrl}/plugins/enable`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        pluginId: "com.engineering-os.runtime-test"
      })
    });

    expect(enableResponse.status).toBe(200);
    await expect(enableResponse.json()).resolves.toMatchObject({
      plugin: {
        pluginId: "com.engineering-os.runtime-test",
        enabled: true
      }
    });

    const startResponse = await fetch(`${runtime.baseUrl}/plugins/runtime/start`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        pluginId: "com.engineering-os.runtime-test"
      })
    });

    expect(startResponse.status).toBe(200);
    await expect(startResponse.json()).resolves.toMatchObject({
      runtime: {
        pluginId: "com.engineering-os.runtime-test",
        status: "running",
        healthy: true
      }
    });

    const healthResponse = await fetch(
      `${runtime.baseUrl}/plugins/runtime?pluginId=com.engineering-os.runtime-test`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toMatchObject({
      runtime: {
        pluginId: "com.engineering-os.runtime-test",
        status: "running",
        healthy: true
      }
    });

    const stopResponse = await fetch(`${runtime.baseUrl}/plugins/runtime/stop`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        pluginId: "com.engineering-os.runtime-test"
      })
    });

    expect(stopResponse.status).toBe(200);
    await expect(stopResponse.json()).resolves.toMatchObject({
      runtime: {
        pluginId: "com.engineering-os.runtime-test",
        status: "stopped",
        healthy: false
      }
    });

    const disableResponse = await fetch(`${runtime.baseUrl}/plugins/disable`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        pluginId: "com.engineering-os.runtime-test"
      })
    });

    expect(disableResponse.status).toBe(200);
    await expect(disableResponse.json()).resolves.toMatchObject({
      plugin: {
        pluginId: "com.engineering-os.runtime-test",
        enabled: false
      }
    });
  });
});
