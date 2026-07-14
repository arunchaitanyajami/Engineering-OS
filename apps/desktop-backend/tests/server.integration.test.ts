import {
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
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
  const defaultMcpServerScript = `
    let buffer = "";

    const writeMessage = (message) => {
      process.stdout.write(JSON.stringify(message) + "\\n");
    };

    const handleMessage = (message) => {
      if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
        return;
      }

      switch (message.method) {
        case "initialize":
          writeMessage({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
              capabilities: {
                tools: {},
                resources: {},
                prompts: {}
              },
              serverInfo: {
                name: "fixture-mcp-server",
                version: "1.0.0"
              }
            }
          });
          return;
        case "notifications/initialized":
          return;
        case "tools/list":
          writeMessage({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              tools: [
                {
                  name: "read_workspace",
                  title: "Read Workspace",
                  description: "Reads files from the workspace.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      path: {
                        type: "string"
                      }
                    },
                    required: ["path"]
                  },
                  outputSchema: {
                    type: "object",
                    properties: {
                      echoedPath: {
                        type: "string"
                      }
                    },
                    required: ["echoedPath"]
                  },
                  annotations: {
                    readOnlyHint: true
                  }
                }
              ]
            }
          });
          return;
        case "tools/call": {
          const toolArguments = message.params?.arguments ?? {};

          if (toolArguments.mode === "hang") {
            return;
          }

          if (toolArguments.mode === "timeout") {
            setTimeout(() => {
              writeMessage({
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  content: [
                    {
                      type: "text",
                      text: "Late response"
                    }
                  ]
                }
              });
            }, 150);
            return;
          }

          if (toolArguments.mode === "error") {
            writeMessage({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                content: [
                  {
                    type: "text",
                    text: "Workspace read failed."
                  }
                ],
                isError: true
              }
            });
            return;
          }

          writeMessage({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              content: [
                {
                  type: "text",
                  text: \`Read \${toolArguments.path ?? "unknown"}\`
                },
                {
                  type: "resource_link",
                  uri: "file:///workspace/result.txt",
                  name: "Result File",
                  title: "Result File"
                }
              ],
              structuredContent: {
                echoedPath: toolArguments.path ?? "unknown"
              }
            }
          });
          return;
        }
        case "resources/list":
          writeMessage({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              resources: [
                {
                  uri: "file:///workspace/README.md",
                  name: "Workspace README",
                  description: "Repository overview."
                }
              ]
            }
          });
          return;
        case "prompts/list":
          writeMessage({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              prompts: [
                {
                  name: "summarize_changes",
                  description: "Summarizes code changes.",
                  arguments: [
                    {
                      name: "scope",
                      description: "Changed area",
                      required: false
                    }
                  ]
                }
              ]
            }
          });
          return;
        default:
          if (message.id !== undefined) {
            writeMessage({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32601,
                message: "Method not found"
              }
            });
          }
      }
    };

    process.stdin.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      while (true) {
        const newlineIndex = buffer.indexOf("\\n");

        if (newlineIndex === -1) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).replace(/\\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);

        if (!line.trim()) {
          continue;
        }

        handleMessage(JSON.parse(line));
      }
    });

    process.on("SIGTERM", () => {
      process.exit(0);
    });
  `;

  const createLocalPluginPackage = async (
    rootDirectory: string,
    options: {
      readonly pluginId?: string;
      readonly engineeringOsRange?: string;
      readonly mcp?: readonly {
        readonly id: string;
        readonly name?: string;
        readonly transport: "stdio";
        readonly command: string;
        readonly args?: readonly string[];
        readonly cwd?: string;
        readonly env?: Readonly<
          Record<string, string | { readonly key: string }>
        >;
        readonly timeoutMs?: number;
        readonly serverScript?: string;
      }[];
    } = {}
  ) => {
    const packageDirectory = await mkdtemp(
      join(rootDirectory, "plugin-package-")
    );
    const manifest = {
      schemaVersion: "1",
      id: options.pluginId ?? "com.engineering-os.filesystem",
      name: "Filesystem Plugin",
      version: "0.1.0",
      description:
        "Reference local plugin package for backend integration tests.",
      publisher: {
        name: "Engineering OS"
      },
      engines: {
        engineeringOs: options.engineeringOsRange ?? ">=0.1.0"
      },
      entrypoints: {
        backend: "./dist/backend/index.js"
      },
      capabilities: options.mcp?.length ? ["mcp-server"] : [],
      permissions: options.mcp?.length
        ? [
            {
              scope: "process.spawn",
              reason:
                "Launches bundled MCP servers for backend integration tests."
            },
            {
              scope: "mcp.register-server",
              reason:
                "Registers bundled MCP servers for backend integration tests."
            }
          ]
        : [],
      mcp: options.mcp ?? []
    };

    await mkdir(join(packageDirectory, "dist/backend"), { recursive: true });
    for (const server of options.mcp ?? []) {
      if (!server.cwd) {
        continue;
      }

      await mkdir(join(packageDirectory, server.cwd), { recursive: true });
      await writeFile(
        join(packageDirectory, server.cwd, "index.js"),
        server.serverScript ?? defaultMcpServerScript,
        "utf8"
      );
    }
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

  const createLocalCommandServer = async (
    rootDirectory: string,
    options: {
      readonly serverScript?: string;
    } = {}
  ) => {
    const serverDirectory = await mkdtemp(join(rootDirectory, "mcp-command-"));
    await writeFile(
      join(serverDirectory, "index.js"),
      options.serverScript ?? defaultMcpServerScript,
      "utf8"
    );

    return {
      serverDirectory
    };
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

  it("lists manifest-backed MCP gateway registrations through the backend API", async () => {
    runtime = await startRuntime();
    const packageDirectory = await createLocalPluginPackage(appDataDirectory, {
      pluginId: "com.engineering-os.mcp-test",
      mcp: [
        {
          id: "filesystem",
          name: "Filesystem",
          transport: "stdio",
          command: "node",
          args: ["./index.js"],
          cwd: "./servers/filesystem",
          env: {
            MCP_MODE: "test",
            API_TOKEN: {
              key: "api-token"
            }
          },
          timeoutMs: 10_000
        }
      ]
    });

    await fetch(`${runtime.baseUrl}/plugins/register-local`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({ packagePath: packageDirectory })
    });

    const disabledResponse = await fetch(`${runtime.baseUrl}/mcp/servers`, {
      headers: authenticatedHeaders()
    });

    expect(disabledResponse.status).toBe(200);
    await expect(disabledResponse.json()).resolves.toMatchObject({
      servers: [
        {
          registrationId: "com.engineering-os.mcp-test:filesystem",
          source: {
            type: "plugin",
            pluginId: "com.engineering-os.mcp-test"
          },
          enabled: false,
          status: "disabled",
          transport: {
            type: "stdio",
            command: "node",
            args: ["./index.js"],
            timeoutMs: 10_000,
            env: {
              MCP_MODE: "test",
              API_TOKEN: {
                key: "api-token"
              }
            }
          }
        }
      ]
    });

    await fetch(`${runtime.baseUrl}/plugins/enable`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        pluginId: "com.engineering-os.mcp-test"
      })
    });

    const enabledResponse = await fetch(
      `${runtime.baseUrl}/mcp/servers?pluginId=com.engineering-os.mcp-test`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(enabledResponse.status).toBe(200);
    await expect(enabledResponse.json()).resolves.toMatchObject({
      servers: [
        {
          registrationId: "com.engineering-os.mcp-test:filesystem",
          enabled: true,
          status: "registered"
        }
      ]
    });
  });

  it("exposes MCP gateway health and catalog endpoints through the backend API", async () => {
    runtime = await startRuntime();
    const packageDirectory = await createLocalPluginPackage(appDataDirectory, {
      pluginId: "com.engineering-os.mcp-health",
      mcp: [
        {
          id: "filesystem",
          name: "Filesystem",
          transport: "stdio",
          command: "node",
          args: ["./index.js"],
          cwd: "./servers/filesystem"
        }
      ]
    });

    await fetch(`${runtime.baseUrl}/plugins/register-local`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({ packagePath: packageDirectory })
    });

    const healthResponse = await fetch(
      `${runtime.baseUrl}/mcp/health?pluginId=com.engineering-os.mcp-health`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toMatchObject({
      servers: [
        {
          registrationId: "com.engineering-os.mcp-health:filesystem",
          enabled: false,
          status: "disabled",
          healthState: "unknown",
          discoveryStatus: "not-started",
          catalog: {
            tools: [],
            resources: [],
            prompts: []
          }
        }
      ]
    });

    const catalogResponse = await fetch(
      `${runtime.baseUrl}/mcp/catalog?pluginId=com.engineering-os.mcp-health&serverId=filesystem`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(catalogResponse.status).toBe(200);
    await expect(catalogResponse.json()).resolves.toEqual({
      catalog: {
        tools: [],
        resources: [],
        prompts: []
      }
    });
  });

  it("exposes provider-independent MCP capability collections through the backend API", async () => {
    runtime = await startRuntime();
    const packageDirectory = await createLocalPluginPackage(appDataDirectory, {
      pluginId: "com.engineering-os.mcp-capabilities",
      mcp: [
        {
          id: "filesystem",
          name: "Filesystem",
          transport: "stdio",
          command: "node",
          args: ["./index.js"],
          cwd: "./servers/filesystem"
        }
      ]
    });

    await fetch(`${runtime.baseUrl}/plugins/register-local`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({ packagePath: packageDirectory })
    });

    const toolsResponse = await fetch(
      `${runtime.baseUrl}/mcp/tools?pluginId=com.engineering-os.mcp-capabilities&serverId=filesystem`,
      {
        headers: authenticatedHeaders()
      }
    );
    const resourcesResponse = await fetch(
      `${runtime.baseUrl}/mcp/resources?pluginId=com.engineering-os.mcp-capabilities&serverId=filesystem`,
      {
        headers: authenticatedHeaders()
      }
    );
    const promptsResponse = await fetch(
      `${runtime.baseUrl}/mcp/prompts?pluginId=com.engineering-os.mcp-capabilities&serverId=filesystem`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(toolsResponse.status).toBe(200);
    await expect(toolsResponse.json()).resolves.toEqual({
      tools: []
    });

    expect(resourcesResponse.status).toBe(200);
    await expect(resourcesResponse.json()).resolves.toEqual({
      resources: []
    });

    expect(promptsResponse.status).toBe(200);
    await expect(promptsResponse.json()).resolves.toEqual({
      prompts: []
    });
  });

  it("starts and stops MCP stdio servers through the backend API", async () => {
    runtime = await startRuntime();
    const packageDirectory = await createLocalPluginPackage(appDataDirectory, {
      pluginId: "com.engineering-os.mcp-runtime",
      mcp: [
        {
          id: "filesystem",
          name: "Filesystem",
          transport: "stdio",
          command: "node",
          args: ["./index.js"],
          cwd: "./servers/filesystem"
        }
      ]
    });

    await fetch(`${runtime.baseUrl}/plugins/register-local`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({ packagePath: packageDirectory })
    });
    await fetch(`${runtime.baseUrl}/plugins/enable`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        pluginId: "com.engineering-os.mcp-runtime"
      })
    });

    const startResponse = await fetch(`${runtime.baseUrl}/mcp/servers/start`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registrationId: "com.engineering-os.mcp-runtime:filesystem"
      })
    });

    expect(startResponse.status).toBe(200);
    await expect(startResponse.json()).resolves.toMatchObject({
      server: {
        registrationId: "com.engineering-os.mcp-runtime:filesystem",
        healthState: "healthy",
        status: "registered",
        discoveryStatus: "discovered",
        catalog: {
          tools: [
            {
              name: "read_workspace"
            }
          ],
          resources: [
            {
              uri: "file:///workspace/README.md"
            }
          ],
          prompts: [
            {
              name: "summarize_changes"
            }
          ]
        }
      }
    });

    const healthResponse = await fetch(
      `${runtime.baseUrl}/mcp/health?pluginId=com.engineering-os.mcp-runtime`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toMatchObject({
      servers: [
        {
          registrationId: "com.engineering-os.mcp-runtime:filesystem",
          healthState: "healthy",
          discoveryStatus: "discovered"
        }
      ]
    });

    const catalogResponse = await fetch(
      `${runtime.baseUrl}/mcp/catalog?pluginId=com.engineering-os.mcp-runtime&serverId=filesystem`,
      {
        headers: authenticatedHeaders()
      }
    );
    const toolsResponse = await fetch(
      `${runtime.baseUrl}/mcp/tools?pluginId=com.engineering-os.mcp-runtime&serverId=filesystem`,
      {
        headers: authenticatedHeaders()
      }
    );
    const resourcesResponse = await fetch(
      `${runtime.baseUrl}/mcp/resources?pluginId=com.engineering-os.mcp-runtime&serverId=filesystem`,
      {
        headers: authenticatedHeaders()
      }
    );
    const promptsResponse = await fetch(
      `${runtime.baseUrl}/mcp/prompts?pluginId=com.engineering-os.mcp-runtime&serverId=filesystem`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(catalogResponse.status).toBe(200);
    await expect(catalogResponse.json()).resolves.toMatchObject({
      catalog: {
        tools: [
          {
            id: "com.engineering-os.mcp-runtime.filesystem.tool.read_workspace",
            name: "read_workspace"
          }
        ],
        resources: [
          {
            id: "com.engineering-os.mcp-runtime.filesystem.resource.file-workspace-readme.md",
            uri: "file:///workspace/README.md"
          }
        ],
        prompts: [
          {
            id: "com.engineering-os.mcp-runtime.filesystem.prompt.summarize_changes",
            name: "summarize_changes"
          }
        ]
      }
    });

    expect(toolsResponse.status).toBe(200);
    await expect(toolsResponse.json()).resolves.toMatchObject({
      tools: [
        {
          id: "com.engineering-os.mcp-runtime.filesystem.tool.read_workspace",
          name: "read_workspace",
          riskLevel: "read-only"
        }
      ]
    });

    expect(resourcesResponse.status).toBe(200);
    await expect(resourcesResponse.json()).resolves.toMatchObject({
      resources: [
        {
          id: "com.engineering-os.mcp-runtime.filesystem.resource.file-workspace-readme.md",
          uri: "file:///workspace/README.md"
        }
      ]
    });

    expect(promptsResponse.status).toBe(200);
    await expect(promptsResponse.json()).resolves.toMatchObject({
      prompts: [
        {
          id: "com.engineering-os.mcp-runtime.filesystem.prompt.summarize_changes",
          name: "summarize_changes"
        }
      ]
    });

    const stopResponse = await fetch(`${runtime.baseUrl}/mcp/servers/stop`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registrationId: "com.engineering-os.mcp-runtime:filesystem"
      })
    });

    expect(stopResponse.status).toBe(200);
    await expect(stopResponse.json()).resolves.toMatchObject({
      server: {
        registrationId: "com.engineering-os.mcp-runtime:filesystem",
        healthState: "unknown",
        discoveryStatus: "discovered"
      }
    });
  });

  it("registers, starts, and unregisters user MCP servers through the backend API", async () => {
    runtime = await startRuntime();
    const { serverDirectory } =
      await createLocalCommandServer(appDataDirectory);

    const registerResponse = await fetch(
      `${runtime.baseUrl}/mcp/servers/register`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          registration: {
            id: "user-filesystem",
            source: {
              type: "user"
            },
            name: "User Filesystem",
            transport: {
              type: "stdio",
              command: "node",
              args: ["./index.js"],
              cwd: serverDirectory
            },
            enabled: true,
            timeoutMs: 10_000
          }
        })
      }
    );

    expect(registerResponse.status).toBe(200);
    await expect(registerResponse.json()).resolves.toMatchObject({
      server: {
        registrationId: "user:user-filesystem",
        source: {
          type: "user"
        },
        status: "registered"
      }
    });

    const listResponse = await fetch(`${runtime.baseUrl}/mcp/servers`, {
      headers: authenticatedHeaders()
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      servers: expect.arrayContaining([
        expect.objectContaining({
          registrationId: "user:user-filesystem",
          source: {
            type: "user"
          }
        })
      ])
    });

    const startResponse = await fetch(`${runtime.baseUrl}/mcp/servers/start`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registrationId: "user:user-filesystem"
      })
    });

    expect(startResponse.status).toBe(200);
    await expect(startResponse.json()).resolves.toMatchObject({
      server: {
        registrationId: "user:user-filesystem",
        healthState: "healthy",
        discoveryStatus: "discovered"
      }
    });

    const unregisterResponse = await fetch(
      `${runtime.baseUrl}/mcp/servers/unregister`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          registrationId: "user:user-filesystem"
        })
      }
    );

    expect(unregisterResponse.status).toBe(200);
    await expect(unregisterResponse.json()).resolves.toEqual({
      ok: true
    });

    const afterUnregisterListResponse = await fetch(
      `${runtime.baseUrl}/mcp/servers`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(afterUnregisterListResponse.status).toBe(200);
    await expect(afterUnregisterListResponse.json()).resolves.toEqual({
      servers: expect.not.arrayContaining([
        expect.objectContaining({
          registrationId: "user:user-filesystem"
        })
      ])
    });
  });

  it("executes MCP tools through the backend API", async () => {
    runtime = await startRuntime();
    const { serverDirectory } =
      await createLocalCommandServer(appDataDirectory);

    await fetch(`${runtime.baseUrl}/mcp/servers/register`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registration: {
          id: "user-filesystem",
          source: {
            type: "user"
          },
          name: "User Filesystem",
          transport: {
            type: "stdio",
            command: "node",
            args: ["./index.js"],
            cwd: serverDirectory
          },
          enabled: true,
          timeoutMs: 10_000
        }
      })
    });
    await fetch(`${runtime.baseUrl}/mcp/servers/start`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registrationId: "user:user-filesystem"
      })
    });

    const successResponse = await fetch(
      `${runtime.baseUrl}/mcp/tools/execute`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          toolId: "user.user-filesystem.tool.read_workspace",
          arguments: {
            path: "/workspace/README.md"
          },
          executionContext: {
            actor: {
              type: "user"
            },
            correlationId: "corr-success",
            approvalMode: "none"
          }
        })
      }
    );

    expect(successResponse.status).toBe(200);
    await expect(successResponse.json()).resolves.toMatchObject({
      result: {
        status: "success",
        content: [
          {
            type: "text",
            text: "Read /workspace/README.md"
          },
          {
            type: "resource-link",
            uri: "file:///workspace/result.txt",
            title: "Result File"
          }
        ],
        metadata: {
          structuredContent: {
            echoedPath: "/workspace/README.md"
          }
        }
      }
    });
  });

  it("normalizes MCP tool errors and timeouts through the backend API", async () => {
    runtime = await startRuntime();
    const { serverDirectory } =
      await createLocalCommandServer(appDataDirectory);

    await fetch(`${runtime.baseUrl}/mcp/servers/register`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registration: {
          id: "timeout-filesystem",
          source: {
            type: "user"
          },
          name: "Timeout Filesystem",
          transport: {
            type: "stdio",
            command: "node",
            args: ["./index.js"],
            cwd: serverDirectory
          },
          enabled: true,
          timeoutMs: 100
        }
      })
    });
    await fetch(`${runtime.baseUrl}/mcp/servers/start`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registrationId: "user:timeout-filesystem"
      })
    });

    const errorResponse = await fetch(`${runtime.baseUrl}/mcp/tools/execute`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        toolId: "user.timeout-filesystem.tool.read_workspace",
        arguments: {
          mode: "error"
        },
        executionContext: {
          actor: {
            type: "agent",
            id: "architect"
          },
          correlationId: "corr-error",
          approvalMode: "none"
        }
      })
    });

    expect(errorResponse.status).toBe(200);
    await expect(errorResponse.json()).resolves.toMatchObject({
      result: {
        status: "error",
        error: {
          code: "MCP_TOOL_EXECUTION_ERROR",
          message: "Workspace read failed."
        }
      }
    });

    const timeoutResponse = await fetch(
      `${runtime.baseUrl}/mcp/tools/execute`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          toolId: "user.timeout-filesystem.tool.read_workspace",
          arguments: {
            mode: "timeout"
          },
          executionContext: {
            actor: {
              type: "agent",
              id: "architect"
            },
            correlationId: "corr-timeout",
            approvalMode: "none"
          }
        })
      }
    );

    expect(timeoutResponse.status).toBe(200);
    await expect(timeoutResponse.json()).resolves.toMatchObject({
      result: {
        status: "timeout",
        error: {
          code: "MCP_TOOL_EXECUTION_TIMEOUT"
        }
      }
    });
  });

  it("cancels MCP tool execution when the client disconnects", async () => {
    runtime = await startRuntime();
    const { serverDirectory } =
      await createLocalCommandServer(appDataDirectory);

    await fetch(`${runtime.baseUrl}/mcp/servers/register`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registration: {
          id: "cancel-filesystem",
          source: {
            type: "user"
          },
          name: "Cancel Filesystem",
          transport: {
            type: "stdio",
            command: "node",
            args: ["./index.js"],
            cwd: serverDirectory
          },
          enabled: true,
          timeoutMs: 10_000
        }
      })
    });
    await fetch(`${runtime.baseUrl}/mcp/servers/start`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registrationId: "user:cancel-filesystem"
      })
    });

    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(
        `${runtime?.baseUrl}/mcp/tools/execute`,
        {
          method: "POST",
          headers: authenticatedHeaders({
            "content-type": "application/json"
          })
        },
        () => {
          reject(new Error("Execution request should have been aborted."));
        }
      );

      request.on("error", (error: Error) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          error.name === "AbortError"
        ) {
          resolve();
          return;
        }

        reject(error);
      });

      request.write(
        JSON.stringify({
          toolId: "user.cancel-filesystem.tool.read_workspace",
          arguments: {
            mode: "hang"
          },
          executionContext: {
            actor: {
              type: "agent",
              id: "architect"
            },
            correlationId: "corr-cancel",
            approvalMode: "none"
          }
        })
      );
      request.end();

      setTimeout(() => {
        request.destroy(
          Object.assign(new Error("cancelled"), {
            name: "AbortError"
          })
        );
      }, 25);
    });

    const verificationResponse = await fetch(
      `${runtime.baseUrl}/mcp/tools/execute`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          toolId: "user.cancel-filesystem.tool.read_workspace",
          arguments: {
            path: "/workspace/README.md"
          },
          executionContext: {
            actor: {
              type: "agent",
              id: "architect"
            },
            correlationId: "corr-after-cancel",
            approvalMode: "none"
          }
        })
      }
    );

    expect(verificationResponse.status).toBe(200);
    await expect(verificationResponse.json()).resolves.toMatchObject({
      result: {
        status: "success"
      }
    });
  });

  it("tracks explicit MCP tool executions through the backend API", async () => {
    runtime = await startRuntime();
    const { serverDirectory } =
      await createLocalCommandServer(appDataDirectory);

    await fetch(`${runtime.baseUrl}/mcp/servers/register`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registration: {
          id: "tracked-filesystem",
          source: {
            type: "user"
          },
          name: "Tracked Filesystem",
          transport: {
            type: "stdio",
            command: "node",
            args: ["./index.js"],
            cwd: serverDirectory
          },
          enabled: true,
          timeoutMs: 10_000
        }
      })
    });
    await fetch(`${runtime.baseUrl}/mcp/servers/start`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registrationId: "user:tracked-filesystem"
      })
    });

    const startResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions/start`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          toolId: "user.tracked-filesystem.tool.read_workspace",
          arguments: {
            mode: "hang"
          },
          executionContext: {
            actor: {
              type: "workflow",
              id: "mcp-review"
            },
            correlationId: "corr-handle",
            approvalMode: "none"
          }
        })
      }
    );

    expect(startResponse.status).toBe(200);
    const startedBody = (await startResponse.json()) as {
      readonly execution: {
        readonly executionId: string;
        readonly state: string;
      };
    };

    expect(startedBody.execution.state).toBe("running");

    const inspectionResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions?executionId=${startedBody.execution.executionId}`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(inspectionResponse.status).toBe(200);
    await expect(inspectionResponse.json()).resolves.toMatchObject({
      execution: {
        executionId: startedBody.execution.executionId,
        state: "running"
      }
    });

    const cancelResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions/cancel`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          executionId: startedBody.execution.executionId
        })
      }
    );

    expect(cancelResponse.status).toBe(200);
    await expect(cancelResponse.json()).resolves.toMatchObject({
      execution: {
        executionId: startedBody.execution.executionId,
        state: "completed",
        result: {
          status: "cancelled",
          error: {
            code: "MCP_TOOL_EXECUTION_CANCELLED"
          }
        }
      }
    });

    const finalInspectionResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions?executionId=${startedBody.execution.executionId}`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(finalInspectionResponse.status).toBe(200);
    await expect(finalInspectionResponse.json()).resolves.toMatchObject({
      execution: {
        executionId: startedBody.execution.executionId,
        state: "completed",
        result: {
          status: "cancelled"
        }
      }
    });

    const verificationResponse = await fetch(
      `${runtime.baseUrl}/mcp/tools/execute`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          toolId: "user.tracked-filesystem.tool.read_workspace",
          arguments: {
            path: "/workspace/README.md"
          },
          executionContext: {
            actor: {
              type: "workflow",
              id: "mcp-review"
            },
            correlationId: "corr-after-handle-cancel",
            approvalMode: "none"
          }
        })
      }
    );

    expect(verificationResponse.status).toBe(200);
    await expect(verificationResponse.json()).resolves.toMatchObject({
      result: {
        status: "success"
      }
    });
  });

  it("lists tracked MCP tool executions through the backend API with rich filters and limit support", async () => {
    runtime = await startRuntime();
    const { serverDirectory } =
      await createLocalCommandServer(appDataDirectory);

    await fetch(`${runtime.baseUrl}/mcp/servers/register`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registration: {
          id: "listed-filesystem",
          source: {
            type: "user"
          },
          name: "Listed Filesystem",
          transport: {
            type: "stdio",
            command: "node",
            args: ["./index.js"],
            cwd: serverDirectory
          },
          enabled: true,
          timeoutMs: 10_000
        }
      })
    });
    await fetch(`${runtime.baseUrl}/mcp/servers/start`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registrationId: "user:listed-filesystem"
      })
    });

    const runningResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions/start`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          toolId: "user.listed-filesystem.tool.read_workspace",
          arguments: {
            mode: "hang"
          },
          executionContext: {
            actor: {
              type: "workflow",
              id: "mcp-list"
            },
            correlationId: "corr-running",
            approvalMode: "none"
          }
        })
      }
    );
    const runningExecution = (await runningResponse.json()) as {
      readonly execution: {
        readonly executionId: string;
      };
    };

    const completedResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions/start`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          toolId: "user.listed-filesystem.tool.read_workspace",
          arguments: {
            path: "/workspace/README.md"
          },
          executionContext: {
            actor: {
              type: "workflow",
              id: "mcp-list"
            },
            correlationId: "corr-completed",
            approvalMode: "none"
          }
        })
      }
    );
    const completedExecution = (await completedResponse.json()) as {
      readonly execution: {
        readonly executionId: string;
      };
    };

    await new Promise((resolve) => setTimeout(resolve, 25));

    const listResponse = await fetch(`${runtime.baseUrl}/mcp/tool-executions`, {
      headers: authenticatedHeaders()
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      executions: [
        {
          executionId: completedExecution.execution.executionId
        },
        {
          executionId: runningExecution.execution.executionId
        }
      ]
    });

    const runningListResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions?state=running`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(runningListResponse.status).toBe(200);
    await expect(runningListResponse.json()).resolves.toMatchObject({
      executions: [
        {
          executionId: runningExecution.execution.executionId,
          state: "running"
        }
      ]
    });

    const completedListResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions?state=completed`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(completedListResponse.status).toBe(200);
    await expect(completedListResponse.json()).resolves.toMatchObject({
      executions: [
        {
          executionId: completedExecution.execution.executionId,
          state: "completed",
          result: {
            status: "success"
          }
        }
      ]
    });

    const correlationListResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions?correlationId=corr-completed`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(correlationListResponse.status).toBe(200);
    await expect(correlationListResponse.json()).resolves.toMatchObject({
      executions: [
        {
          executionId: completedExecution.execution.executionId,
          request: {
            executionContext: {
              correlationId: "corr-completed"
            }
          }
        }
      ]
    });

    const scopedListResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions?registrationId=user:listed-filesystem&serverId=listed-filesystem&state=running`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(scopedListResponse.status).toBe(200);
    await expect(scopedListResponse.json()).resolves.toMatchObject({
      executions: [
        {
          executionId: runningExecution.execution.executionId,
          registrationId: "user:listed-filesystem",
          serverId: "listed-filesystem",
          state: "running"
        }
      ]
    });

    const limitedListResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions?limit=1`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(limitedListResponse.status).toBe(200);
    const limitedListBody = (await limitedListResponse.json()) as {
      readonly executions: readonly {
        readonly executionId: string;
      }[];
      readonly nextCursor?: string;
    };

    expect(limitedListBody).toMatchObject({
      executions: [
        {
          executionId: completedExecution.execution.executionId
        }
      ],
      nextCursor: completedExecution.execution.executionId
    });
    expect(limitedListBody.nextCursor).toBeDefined();

    const nextPageResponse = await fetch(
      `${runtime.baseUrl}/mcp/tool-executions?limit=1&cursor=${limitedListBody.nextCursor ?? completedExecution.execution.executionId}`,
      {
        headers: authenticatedHeaders()
      }
    );

    expect(nextPageResponse.status).toBe(200);
    await expect(nextPageResponse.json()).resolves.toMatchObject({
      executions: [
        {
          executionId: runningExecution.execution.executionId
        }
      ]
    });

    await fetch(`${runtime.baseUrl}/mcp/tool-executions/cancel`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        executionId: runningExecution.execution.executionId
      })
    });
  });

  it("rejects non-user MCP registration requests through the backend API", async () => {
    runtime = await startRuntime();
    const { serverDirectory } =
      await createLocalCommandServer(appDataDirectory);

    const response = await fetch(`${runtime.baseUrl}/mcp/servers/register`, {
      method: "POST",
      headers: authenticatedHeaders({
        "content-type": "application/json"
      }),
      body: JSON.stringify({
        registration: {
          id: "system-filesystem",
          source: {
            type: "system"
          },
          name: "System Filesystem",
          transport: {
            type: "stdio",
            command: "node",
            args: ["./index.js"],
            cwd: serverDirectory
          },
          enabled: true
        }
      })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "MCP_GATEWAY_USER_REGISTRATION_REQUIRED",
      message: "User MCP registration requests must use the user source type."
    });
  });

  it("restores persisted user MCP registrations after backend restart", async () => {
    runtime = await startRuntime();
    const { serverDirectory } =
      await createLocalCommandServer(appDataDirectory);

    const registerResponse = await fetch(
      `${runtime.baseUrl}/mcp/servers/register`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          registration: {
            id: "persisted-user-filesystem",
            source: {
              type: "user"
            },
            name: "Persisted User Filesystem",
            transport: {
              type: "stdio",
              command: "node",
              args: ["./index.js"],
              cwd: serverDirectory
            },
            enabled: true,
            timeoutMs: 10_000
          }
        })
      }
    );

    expect(registerResponse.status).toBe(200);
    await runtime.close();
    runtime = await startRuntime();

    const listResponse = await fetch(`${runtime.baseUrl}/mcp/servers`, {
      headers: authenticatedHeaders()
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      servers: expect.arrayContaining([
        expect.objectContaining({
          registrationId: "user:persisted-user-filesystem",
          source: {
            type: "user"
          },
          status: "registered"
        })
      ])
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

    const startResponse = await fetch(
      `${runtime.baseUrl}/plugins/runtime/start`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          pluginId: "com.engineering-os.runtime-test"
        })
      }
    );

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

    const stopResponse = await fetch(
      `${runtime.baseUrl}/plugins/runtime/stop`,
      {
        method: "POST",
        headers: authenticatedHeaders({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          pluginId: "com.engineering-os.runtime-test"
        })
      }
    );

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
