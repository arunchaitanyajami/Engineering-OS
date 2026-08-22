import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApplicationDatabase } from "@engineering-os/database";
import { createLogger } from "@engineering-os/logger";
import {
  FileMcpUserRegistrationStore,
  McpGatewayService,
  type ToolRiskClassificationInput
} from "@engineering-os/mcp-gateway";
import {
  PluginRegistryService,
  SqlitePluginRegistryRepository
} from "@engineering-os/plugin-registry";

const classifyToolRiskForTests = (
  input: ToolRiskClassificationInput
): "read-only" | "write" | "destructive" | "privileged" | "unknown" => {
  const normalized = input.name.trim().toLowerCase().replace(/[_-]+/g, " ");

  if (input.annotations?.destructiveHint) {
    return "destructive";
  }

  if (/\b(read|list|search|get|fetch|find|query)\b/.test(normalized)) {
    return input.annotations?.readOnlyHint ? "read-only" : "read-only";
  }

  if (input.annotations?.readOnlyHint) {
    return "unknown";
  }

  return "unknown";
};

describe("McpGatewayService", () => {
  const databases: ApplicationDatabase[] = [];
  const directories: string[] = [];
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
                      },
                      mode: {
                        type: "string"
                      }
                    },
                    anyOf: [
                      {
                        required: ["path"]
                      },
                      {
                        required: ["mode"]
                      }
                    ],
                    additionalProperties: false
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

  const createGateway = async (
    options: {
      readonly startupTimeoutMs?: number;
      readonly startupStabilityPeriodMs?: number;
      readonly shutdownGracePeriodMs?: number;
    } = {}
  ) => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-mcp-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);

    const pluginRegistry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "mcp-gateway-test" }),
      engineeringOsVersion: "0.1.0",
      installationsRootPath: join(fixturesDirectory, "managed-plugins")
    });
    const gateway = new McpGatewayService({
      installedPlugins: pluginRegistry,
      logger: createLogger({ component: "mcp-gateway-test" }),
      classifyToolRisk: (input) => classifyToolRiskForTests(input),
      ...(options.startupTimeoutMs
        ? { startupTimeoutMs: options.startupTimeoutMs }
        : {}),
      ...(options.startupStabilityPeriodMs
        ? { startupStabilityPeriodMs: options.startupStabilityPeriodMs }
        : {}),
      ...(options.shutdownGracePeriodMs
        ? { shutdownGracePeriodMs: options.shutdownGracePeriodMs }
        : {})
    });

    return {
      fixturesDirectory,
      pluginRegistry,
      gateway
    };
  };

  const createPluginPackage = async (
    rootDirectory: string,
    options: {
      readonly env?: Readonly<
        Record<string, string | { readonly key: string }>
      >;
      readonly args?: readonly string[];
      readonly cwd?: string;
      readonly serverScript?: string;
    } = {}
  ) => {
    const packageDirectory = await mkdtemp(
      join(rootDirectory, "plugin-package-")
    );
    const manifest = {
      schemaVersion: "1",
      id: "com.engineering-os.mcp-plugin",
      name: "MCP Plugin",
      version: "0.1.0",
      description: "Reference plugin package for MCP Gateway tests.",
      publisher: {
        name: "Engineering OS"
      },
      engines: {
        engineeringOs: ">=0.1.0"
      },
      entrypoints: {
        backend: "./dist/backend/index.js"
      },
      capabilities: ["mcp-server"],
      permissions: [
        {
          scope: "process.spawn",
          reason: "Launch bundled MCP servers for integration tests."
        },
        {
          scope: "mcp.register-server",
          reason: "Register bundled MCP servers for integration tests."
        }
      ],
      mcp: [
        {
          id: "filesystem",
          name: "Filesystem",
          transport: "stdio",
          command: "node",
          args: options.args ?? ["./index.js"],
          cwd: options.cwd ?? "./servers/filesystem",
          ...(options.env ? { env: options.env } : {}),
          timeoutMs: 10_000
        }
      ]
    };

    await mkdir(join(packageDirectory, "dist/backend"), { recursive: true });
    await mkdir(join(packageDirectory, "servers/filesystem"), {
      recursive: true
    });
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
      join(packageDirectory, "servers/filesystem/index.js"),
      options.serverScript ?? defaultMcpServerScript,
      "utf8"
    );
    await writeFile(
      join(packageDirectory, "engineering-os.plugin.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );

    return {
      packageDirectory
    };
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

  it("lists manifest-backed plugin MCP server registrations", async () => {
    const { fixturesDirectory, pluginRegistry, gateway } =
      await createGateway();
    const { packageDirectory } = await createPluginPackage(fixturesDirectory, {
      env: {
        MCP_MODE: "test",
        API_TOKEN: {
          key: "api-token"
        }
      }
    });

    await pluginRegistry.registerLocalPluginPackage(packageDirectory);

    expect(gateway.listRegisteredServers()).toMatchObject([
      {
        registrationId: "com.engineering-os.mcp-plugin:filesystem",
        serverId: "filesystem",
        source: {
          type: "plugin",
          pluginId: "com.engineering-os.mcp-plugin"
        },
        name: "Filesystem",
        enabled: false,
        status: "disabled",
        transport: {
          type: "stdio",
          command: "node",
          args: ["./index.js"],
          cwd: join(
            fixturesDirectory,
            "managed-plugins",
            "com.engineering-os.mcp-plugin",
            "0.1.0",
            "servers/filesystem"
          ),
          timeoutMs: 10_000,
          env: {
            MCP_MODE: "test",
            API_TOKEN: {
              key: "api-token"
            }
          }
        }
      }
    ]);
  });

  it("registers and unregisters user MCP servers through the gateway", async () => {
    const { fixturesDirectory, gateway } = await createGateway();
    const { serverDirectory } =
      await createLocalCommandServer(fixturesDirectory);

    expect(
      gateway.registerServer({
        id: "local-filesystem",
        source: {
          type: "user"
        },
        name: "Local Filesystem",
        transport: {
          type: "stdio",
          command: "node",
          args: ["./index.js"],
          cwd: serverDirectory
        },
        enabled: true,
        timeoutMs: 10_000
      })
    ).toMatchObject({
      registrationId: "user:local-filesystem",
      serverId: "local-filesystem",
      source: {
        type: "user"
      },
      enabled: true,
      status: "registered"
    });

    expect(gateway.listRegisteredServers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          registrationId: "user:local-filesystem",
          source: {
            type: "user"
          }
        })
      ])
    );

    await gateway.unregisterServer("user:local-filesystem");

    expect(gateway.listRegisteredServers()).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          registrationId: "user:local-filesystem"
        })
      ])
    );
  });

  it("persists user MCP registrations in the local file store", async () => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-mcp-")
    );
    directories.push(fixturesDirectory);
    const store = new FileMcpUserRegistrationStore(
      join(fixturesDirectory, "mcp-user-registrations.json")
    );

    await store.save([
      {
        id: "user-filesystem",
        source: {
          type: "user"
        },
        name: "User Filesystem",
        transport: {
          type: "stdio",
          command: "node",
          args: ["./index.js"],
          cwd: fixturesDirectory
        },
        enabled: true,
        timeoutMs: 10_000
      }
    ]);

    await expect(store.load()).resolves.toEqual([
      {
        id: "user-filesystem",
        source: {
          type: "user"
        },
        name: "User Filesystem",
        transport: {
          type: "stdio",
          command: "node",
          args: ["./index.js"],
          cwd: fixturesDirectory
        },
        enabled: true,
        timeoutMs: 10_000
      }
    ]);
  });

  it("rejects persisting literal secret-like user MCP environment values", async () => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-mcp-")
    );
    directories.push(fixturesDirectory);
    const store = new FileMcpUserRegistrationStore(
      join(fixturesDirectory, "mcp-user-registrations.json")
    );

    await expect(
      store.save([
        {
          id: "user-filesystem",
          source: {
            type: "user"
          },
          name: "User Filesystem",
          transport: {
            type: "stdio",
            command: "node",
            args: ["./index.js"],
            cwd: fixturesDirectory,
            env: {
              API_KEY: "plaintext-secret"
            }
          },
          enabled: true,
          timeoutMs: 10_000
        }
      ])
    ).rejects.toMatchObject({
      code: "MCP_USER_REGISTRATION_LITERAL_SECRET_FORBIDDEN",
      statusCode: 400
    });
  });

  it("reflects plugin enablement in MCP registration status", async () => {
    const { fixturesDirectory, pluginRegistry, gateway } =
      await createGateway();
    const { packageDirectory } = await createPluginPackage(fixturesDirectory, {
      env: {
        MCP_MODE: "test",
        API_TOKEN: {
          key: "api-token"
        }
      }
    });
    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(packageDirectory);

    pluginRegistry.enableInstalledPlugin(installedPlugin.pluginId);

    expect(gateway.listRegisteredServers()).toMatchObject([
      {
        registrationId: "com.engineering-os.mcp-plugin:filesystem",
        enabled: true,
        status: "registered"
      }
    ]);
  });

  it("exposes gateway-owned health snapshots for registered servers", async () => {
    const { fixturesDirectory, pluginRegistry, gateway } =
      await createGateway();
    const { packageDirectory } = await createPluginPackage(fixturesDirectory, {
      env: {
        MCP_MODE: "test",
        API_TOKEN: {
          key: "api-token"
        }
      }
    });
    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(packageDirectory);

    pluginRegistry.enableInstalledPlugin(installedPlugin.pluginId);

    expect(gateway.listServerHealth()).toMatchObject([
      {
        registrationId: "com.engineering-os.mcp-plugin:filesystem",
        enabled: true,
        status: "registered",
        healthState: "unknown",
        discoveryStatus: "not-started",
        catalog: {
          tools: [],
          resources: [],
          prompts: []
        }
      }
    ]);
  });

  it("returns a normalized empty catalog before live capability discovery is implemented", async () => {
    const { fixturesDirectory, pluginRegistry, gateway } =
      await createGateway();
    const { packageDirectory } = await createPluginPackage(fixturesDirectory, {
      env: {
        MCP_MODE: "test",
        API_TOKEN: {
          key: "api-token"
        }
      }
    });

    await pluginRegistry.registerLocalPluginPackage(packageDirectory);

    expect(gateway.getCatalog()).toEqual({
      tools: [],
      resources: [],
      prompts: []
    });
  });

  it("lists provider-independent capability collections from the gateway boundary after live discovery", async () => {
    const { fixturesDirectory, pluginRegistry, gateway } =
      await createGateway();
    const { packageDirectory } = await createPluginPackage(fixturesDirectory, {
      env: {
        MCP_MODE: "test"
      }
    });
    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(packageDirectory);

    pluginRegistry.enableInstalledPlugin(installedPlugin.pluginId);
    await gateway.startServer("com.engineering-os.mcp-plugin:filesystem");

    expect(gateway.listTools()).toMatchObject([
      {
        id: "com.engineering-os.mcp-plugin.filesystem.tool.read_workspace",
        serverId: "filesystem",
        pluginId: "com.engineering-os.mcp-plugin",
        name: "read_workspace",
        title: "Read Workspace",
        riskLevel: "read-only"
      }
    ]);
    expect(gateway.listResources()).toMatchObject([
      {
        id: "com.engineering-os.mcp-plugin.filesystem.resource.file-workspace-readme.md",
        serverId: "filesystem",
        pluginId: "com.engineering-os.mcp-plugin",
        name: "Workspace README",
        uri: "file:///workspace/README.md"
      }
    ]);
    expect(gateway.listPrompts()).toMatchObject([
      {
        id: "com.engineering-os.mcp-plugin.filesystem.prompt.summarize_changes",
        serverId: "filesystem",
        pluginId: "com.engineering-os.mcp-plugin",
        name: "summarize_changes"
      }
    ]);
  });

  it("starts and stops local stdio MCP server processes", async () => {
    const { fixturesDirectory, pluginRegistry, gateway } =
      await createGateway();
    const { packageDirectory } = await createPluginPackage(fixturesDirectory, {
      env: {
        MCP_MODE: "test"
      }
    });
    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(packageDirectory);

    pluginRegistry.enableInstalledPlugin(installedPlugin.pluginId);

    await expect(
      gateway.startServer("com.engineering-os.mcp-plugin:filesystem")
    ).resolves.toMatchObject({
      registrationId: "com.engineering-os.mcp-plugin:filesystem",
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
    });

    await expect(
      gateway.stopServer("com.engineering-os.mcp-plugin:filesystem")
    ).resolves.toMatchObject({
      registrationId: "com.engineering-os.mcp-plugin:filesystem",
      healthState: "unknown",
      discoveryStatus: "discovered",
      catalog: {
        tools: [
          {
            name: "read_workspace"
          }
        ]
      }
    });
  });

  it("restarts MCP stdio servers after an unexpected post-startup exit", async () => {
    const crashAfterReadyScript = defaultMcpServerScript.replace(
      `        case "notifications/initialized":
          return;`,
      `        case "notifications/initialized":
          setTimeout(() => process.exit(17), 1_000);
          return;`
    );
    const { fixturesDirectory, pluginRegistry, gateway } =
      await createGateway();
    const { packageDirectory } = await createPluginPackage(fixturesDirectory, {
      serverScript: crashAfterReadyScript
    });

    await pluginRegistry.registerLocalPluginPackage(packageDirectory);
    pluginRegistry.enableInstalledPlugin("com.engineering-os.mcp-plugin");

    const registrationId = "com.engineering-os.mcp-plugin:filesystem";
    await gateway.startServer(registrationId);

    const startedAt = Date.now();

    while (Date.now() - startedAt <= 10_000) {
      const health = gateway.inspectServerHealth(registrationId);

      if (health.restartCount >= 1 && health.healthState === "healthy") {
        expect(health).toMatchObject({
          healthState: "healthy",
          restartCount: 1
        });
        await gateway.stopServer(registrationId);
        return;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }

    throw new Error("MCP server did not restart after an unexpected exit.");
  });

  it("executes discovered MCP tools through the gateway boundary", async () => {
    const { fixturesDirectory, gateway } = await createGateway();
    const { serverDirectory } =
      await createLocalCommandServer(fixturesDirectory);

    gateway.registerServer({
      id: "local-filesystem",
      source: {
        type: "user"
      },
      name: "Local Filesystem",
      transport: {
        type: "stdio",
        command: "node",
        args: ["./index.js"],
        cwd: serverDirectory
      },
      enabled: true,
      timeoutMs: 10_000
    });
    await gateway.startServer("user:local-filesystem");

    await expect(
      gateway.executeTool({
        toolId: "user.local-filesystem.tool.read_workspace",
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
    ).resolves.toMatchObject({
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
    });
  });

  it("validates MCP tool arguments against discovered schemas before invocation", async () => {
    const { fixturesDirectory, gateway } = await createGateway();
    const callCountPath = join(fixturesDirectory, "tool-call-count.txt");
    const { serverDirectory } = await createLocalCommandServer(
      fixturesDirectory,
      {
        serverScript: `
          const { readFileSync, writeFileSync } = require("node:fs");

          let buffer = "";
          const writeMessage = (message) => {
            process.stdout.write(JSON.stringify(message) + "\\n");
          };
          const incrementCount = () => {
            let currentCount = 0;
            try {
              currentCount = Number(readFileSync(${JSON.stringify(callCountPath)}, "utf8"));
            } catch {}
            writeFileSync(${JSON.stringify(callCountPath)}, String(currentCount + 1), "utf8");
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
                    capabilities: { tools: {} },
                    serverInfo: { name: "strict-fixture", version: "1.0.0" }
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
                        description: "Strict schema tool.",
                        inputSchema: {
                          type: "object",
                          properties: {
                            path: { type: "string" },
                            filters: {
                              type: "object",
                              properties: {
                                tags: {
                                  type: "array",
                                  items: { type: "string" }
                                },
                                recurse: { type: "boolean" }
                              },
                              required: ["tags"],
                              additionalProperties: false
                            }
                          },
                          required: ["path", "filters"],
                          additionalProperties: false
                        },
                        outputSchema: {
                          type: "object",
                          properties: {
                            ok: { type: "boolean" }
                          },
                          required: ["ok"]
                        }
                      }
                    ]
                  }
                });
                return;
              case "tools/call":
                incrementCount();
                writeMessage({
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    content: [
                      {
                        type: "text",
                        text: "validated"
                      }
                    ],
                    structuredContent: {
                      ok: true
                    }
                  }
                });
                return;
              default:
                return;
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
        `
      }
    );

    gateway.registerServer({
      id: "strict-filesystem",
      source: {
        type: "user"
      },
      name: "Strict Filesystem",
      transport: {
        type: "stdio",
        command: "node",
        args: ["./index.js"],
        cwd: serverDirectory
      },
      enabled: true,
      timeoutMs: 10_000
    });
    await gateway.startServer("user:strict-filesystem");

    const executionContext = {
      actor: {
        type: "agent" as const,
        id: "architect"
      },
      correlationId: "corr-validate",
      approvalMode: "none" as const
    };

    await expect(
      gateway.executeTool({
        toolId: "user.strict-filesystem.tool.read_workspace",
        arguments: {
          filters: {
            tags: ["docs"]
          }
        },
        executionContext
      })
    ).rejects.toMatchObject({
      code: "MCP_GATEWAY_TOOL_ARGUMENTS_INVALID",
      statusCode: 400
    });
    await expect(
      gateway.executeTool({
        toolId: "user.strict-filesystem.tool.read_workspace",
        arguments: {
          path: 42,
          filters: {
            tags: ["docs"]
          }
        },
        executionContext
      })
    ).rejects.toMatchObject({
      code: "MCP_GATEWAY_TOOL_ARGUMENTS_INVALID",
      statusCode: 400
    });
    await expect(
      gateway.executeTool({
        toolId: "user.strict-filesystem.tool.read_workspace",
        arguments: {
          path: "/workspace/README.md",
          filters: {
            tags: ["docs"]
          },
          unexpected: true
        },
        executionContext
      })
    ).rejects.toMatchObject({
      code: "MCP_GATEWAY_TOOL_ARGUMENTS_INVALID",
      statusCode: 400
    });
    await expect(
      gateway.executeTool({
        toolId: "user.strict-filesystem.tool.read_workspace",
        arguments: {
          path: "/workspace/README.md",
          filters: {
            tags: [7]
          }
        },
        executionContext
      })
    ).rejects.toMatchObject({
      code: "MCP_GATEWAY_TOOL_ARGUMENTS_INVALID",
      statusCode: 400
    });

    await expect(readFile(callCountPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    await expect(
      gateway.executeTool({
        toolId: "user.strict-filesystem.tool.read_workspace",
        arguments: {
          path: "/workspace/README.md",
          filters: {
            tags: ["docs"],
            recurse: true
          }
        },
        executionContext
      })
    ).resolves.toMatchObject({
      status: "success"
    });

    await expect(readFile(callCountPath, "utf8")).resolves.toBe("1");
  });

  it("fails startup when a discovered tool exposes an invalid JSON Schema", async () => {
    const { fixturesDirectory, gateway } = await createGateway();
    const { serverDirectory } = await createLocalCommandServer(
      fixturesDirectory,
      {
        serverScript: `
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
                    capabilities: { tools: {} },
                    serverInfo: { name: "invalid-schema", version: "1.0.0" }
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
                        name: "broken_tool",
                        inputSchema: {
                          type: "object",
                          properties: {
                            foo: {
                              type: "string",
                              minimum: "not-a-number"
                            }
                          }
                        }
                      }
                    ]
                  }
                });
                return;
              default:
                return;
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
        `
      }
    );

    gateway.registerServer({
      id: "invalid-schema",
      source: {
        type: "user"
      },
      name: "Invalid Schema",
      transport: {
        type: "stdio",
        command: "node",
        args: ["./index.js"],
        cwd: serverDirectory
      },
      enabled: true,
      timeoutMs: 10_000
    });

    await expect(gateway.startServer("user:invalid-schema")).rejects.toMatchObject(
      {
        code: "MCP_GATEWAY_SERVER_START_FAILED"
      }
    );
    expect(gateway.inspectServerHealth("user:invalid-schema")).toMatchObject({
      discoveryStatus: "failed",
      lastError: "Tool 'user.invalid-schema.tool.broken_tool' exposes an invalid JSON Schema."
    });
  });

  it("fails startup when capability discovery hangs after initialization", async () => {
    const { fixturesDirectory, gateway } = await createGateway({
      startupTimeoutMs: 200
    });
    const { serverDirectory } = await createLocalCommandServer(
      fixturesDirectory,
      {
        serverScript: `
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
                    capabilities: { tools: {} },
                    serverInfo: { name: "hang-discovery", version: "1.0.0" }
                  }
                });
                return;
              case "notifications/initialized":
                return;
              case "tools/list":
                return;
              default:
                return;
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
        `
      }
    );

    gateway.registerServer({
      id: "hang-discovery",
      source: {
        type: "user"
      },
      name: "Hang Discovery",
      transport: {
        type: "stdio",
        command: "node",
        args: ["./index.js"],
        cwd: serverDirectory
      },
      enabled: true,
      timeoutMs: 10_000
    });

    await expect(gateway.startServer("user:hang-discovery")).rejects.toMatchObject(
      {
        code: "MCP_GATEWAY_SERVER_START_FAILED"
      }
    );
    expect(gateway.inspectServerHealth("user:hang-discovery")).toMatchObject({
      discoveryStatus: "failed",
      lastError:
        "MCP server 'user:hang-discovery' did not complete startup before the timeout expired."
    });
  });

  it("fails startup when capability discovery repeats a cursor", async () => {
    const { fixturesDirectory, gateway } = await createGateway({
      startupTimeoutMs: 500
    });
    const { serverDirectory } = await createLocalCommandServer(
      fixturesDirectory,
      {
        serverScript: `
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
                    capabilities: { tools: {} },
                    serverInfo: { name: "repeat-cursor", version: "1.0.0" }
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
                    tools: [],
                    nextCursor: "same-page"
                  }
                });
                return;
              default:
                return;
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
        `
      }
    );

    gateway.registerServer({
      id: "repeat-cursor",
      source: {
        type: "user"
      },
      name: "Repeat Cursor",
      transport: {
        type: "stdio",
        command: "node",
        args: ["./index.js"],
        cwd: serverDirectory
      },
      enabled: true,
      timeoutMs: 10_000
    });

    await expect(gateway.startServer("user:repeat-cursor")).rejects.toMatchObject({
      code: "MCP_GATEWAY_SERVER_START_FAILED",
      cause: expect.objectContaining({
        code: "MCP_GATEWAY_DISCOVERY_CURSOR_REPEATED"
      })
    });
  });

  it("fails startup when capability discovery exceeds the maximum page count", async () => {
    const { fixturesDirectory, gateway } = await createGateway({
      startupTimeoutMs: 1_000
    });
    const { serverDirectory } = await createLocalCommandServer(
      fixturesDirectory,
      {
        serverScript: `
          let buffer = "";
          let page = 0;
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
                    capabilities: { tools: {} },
                    serverInfo: { name: "many-pages", version: "1.0.0" }
                  }
                });
                return;
              case "notifications/initialized":
                return;
              case "tools/list":
                page += 1;
                writeMessage({
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    tools: [],
                    nextCursor: "page-" + page
                  }
                });
                return;
              default:
                return;
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
        `
      }
    );

    gateway.registerServer({
      id: "many-pages",
      source: {
        type: "user"
      },
      name: "Many Pages",
      transport: {
        type: "stdio",
        command: "node",
        args: ["./index.js"],
        cwd: serverDirectory
      },
      enabled: true,
      timeoutMs: 10_000
    });

    await expect(gateway.startServer("user:many-pages")).rejects.toMatchObject({
      code: "MCP_GATEWAY_SERVER_START_FAILED",
      cause: expect.objectContaining({
        code: "MCP_GATEWAY_DISCOVERY_PAGE_LIMIT_EXCEEDED"
      })
    });
  });

  it("normalizes MCP tool execution errors and timeouts", async () => {
    const { fixturesDirectory, gateway } = await createGateway();
    const { serverDirectory } =
      await createLocalCommandServer(fixturesDirectory);

    gateway.registerServer({
      id: "local-filesystem",
      source: {
        type: "user"
      },
      name: "Local Filesystem",
      transport: {
        type: "stdio",
        command: "node",
        args: ["./index.js"],
        cwd: serverDirectory
      },
      enabled: true,
      timeoutMs: 100
    });
    await gateway.startServer("user:local-filesystem");

    await expect(
      gateway.executeTool({
        toolId: "user.local-filesystem.tool.read_workspace",
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
    ).resolves.toMatchObject({
      status: "error",
      error: {
        code: "MCP_TOOL_EXECUTION_ERROR",
        message: "Workspace read failed."
      }
    });

    await expect(
      gateway.executeTool({
        toolId: "user.local-filesystem.tool.read_workspace",
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
    ).resolves.toMatchObject({
      status: "timeout",
      error: {
        code: "MCP_TOOL_EXECUTION_TIMEOUT"
      }
    });
  });

  it("cancels MCP tool execution when the caller aborts", async () => {
    const { fixturesDirectory, gateway } = await createGateway();
    const { serverDirectory } =
      await createLocalCommandServer(fixturesDirectory);
    const abortController = new AbortController();

    gateway.registerServer({
      id: "local-filesystem",
      source: {
        type: "user"
      },
      name: "Local Filesystem",
      transport: {
        type: "stdio",
        command: "node",
        args: ["./index.js"],
        cwd: serverDirectory
      },
      enabled: true,
      timeoutMs: 10_000
    });
    await gateway.startServer("user:local-filesystem");

    const resultPromise = gateway.executeTool(
      {
        toolId: "user.local-filesystem.tool.read_workspace",
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
      },
      {
        signal: abortController.signal
      }
    );

    setTimeout(() => {
      abortController.abort();
    }, 25);

    await expect(resultPromise).resolves.toMatchObject({
      status: "cancelled",
      error: {
        code: "MCP_TOOL_EXECUTION_CANCELLED"
      }
    });
  });

  it("tracks explicit MCP tool executions for later inspection and cancellation", async () => {
    const { fixturesDirectory, gateway } = await createGateway();
    const { serverDirectory } =
      await createLocalCommandServer(fixturesDirectory);

    gateway.registerServer({
      id: "local-filesystem",
      source: {
        type: "user"
      },
      name: "Local Filesystem",
      transport: {
        type: "stdio",
        command: "node",
        args: ["./index.js"],
        cwd: serverDirectory
      },
      enabled: true,
      timeoutMs: 10_000
    });
    await gateway.startServer("user:local-filesystem");

    const startedExecution = gateway.startToolExecution({
      toolId: "user.local-filesystem.tool.read_workspace",
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
    });

    expect(startedExecution).toMatchObject({
      state: "running"
    });
    expect(
      gateway.getToolExecution(startedExecution.executionId)
    ).toMatchObject({
      executionId: startedExecution.executionId,
      state: "running"
    });

    await expect(
      gateway.cancelToolExecution(startedExecution.executionId)
    ).resolves.toMatchObject({
      executionId: startedExecution.executionId,
      state: "completed",
      result: {
        status: "cancelled",
        error: {
          code: "MCP_TOOL_EXECUTION_CANCELLED"
        }
      }
    });

    expect(
      gateway.getToolExecution(startedExecution.executionId)
    ).toMatchObject({
      executionId: startedExecution.executionId,
      state: "completed",
      result: {
        status: "cancelled"
      }
    });
  });

  it("lists tracked MCP tool executions with rich filtering and limit support", async () => {
    const { fixturesDirectory, gateway } = await createGateway();
    const { serverDirectory } =
      await createLocalCommandServer(fixturesDirectory);

    gateway.registerServer({
      id: "local-filesystem",
      source: {
        type: "user"
      },
      name: "Local Filesystem",
      transport: {
        type: "stdio",
        command: "node",
        args: ["./index.js"],
        cwd: serverDirectory
      },
      enabled: true,
      timeoutMs: 10_000
    });
    await gateway.startServer("user:local-filesystem");

    const runningExecution = gateway.startToolExecution({
      toolId: "user.local-filesystem.tool.read_workspace",
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
    });

    const completedExecution = gateway.startToolExecution({
      toolId: "user.local-filesystem.tool.read_workspace",
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
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(gateway.listToolExecutions()).toMatchObject([
      {
        executionId: completedExecution.executionId
      },
      {
        executionId: runningExecution.executionId
      }
    ]);
    expect(
      gateway.listToolExecutions({
        state: "completed"
      })
    ).toMatchObject([
      {
        executionId: completedExecution.executionId,
        state: "completed",
        result: {
          status: "success"
        }
      }
    ]);
    expect(
      gateway.listToolExecutions({
        state: "running"
      })
    ).toMatchObject([
      {
        executionId: runningExecution.executionId,
        state: "running"
      }
    ]);
    expect(
      gateway.listToolExecutions({
        registrationId: "user:local-filesystem"
      })
    ).toHaveLength(2);
    expect(
      gateway.listToolExecutions({
        serverId: "local-filesystem"
      })
    ).toHaveLength(2);
    expect(
      gateway.listToolExecutions({
        correlationId: "corr-completed"
      })
    ).toMatchObject([
      {
        executionId: completedExecution.executionId,
        request: {
          executionContext: {
            correlationId: "corr-completed"
          }
        }
      }
    ]);
    expect(
      gateway.listToolExecutions({
        registrationId: "user:local-filesystem",
        serverId: "local-filesystem",
        correlationId: "corr-running",
        state: "running"
      })
    ).toMatchObject([
      {
        executionId: runningExecution.executionId,
        state: "running"
      }
    ]);
    expect(
      gateway.listToolExecutions({
        limit: 1
      })
    ).toMatchObject([
      {
        executionId: completedExecution.executionId
      }
    ]);
    const firstPage = gateway.listToolExecutionPage({
      limit: 1
    });

    expect(firstPage).toMatchObject({
      executions: [
        {
          executionId: completedExecution.executionId
        }
      ],
      nextCursor: completedExecution.executionId
    });
    expect(firstPage.nextCursor).toBeDefined();

    expect(
      gateway.listToolExecutionPage({
        limit: 1,
        cursor: firstPage.nextCursor ?? completedExecution.executionId
      })
    ).toMatchObject({
      executions: [
        {
          executionId: runningExecution.executionId
        }
      ]
    });

    await gateway.cancelToolExecution(runningExecution.executionId);
  });

  it("rejects unresolved secret references when starting stdio MCP servers", async () => {
    const { fixturesDirectory, pluginRegistry, gateway } =
      await createGateway();
    const { packageDirectory } = await createPluginPackage(fixturesDirectory, {
      env: {
        API_TOKEN: {
          key: "api-token"
        }
      }
    });
    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(packageDirectory);

    pluginRegistry.enableInstalledPlugin(installedPlugin.pluginId);

    await expect(
      gateway.startServer("com.engineering-os.mcp-plugin:filesystem")
    ).rejects.toMatchObject({
      code: "MCP_GATEWAY_SECRET_REFERENCES_UNSUPPORTED",
      statusCode: 501
    });
  });

  it("rejects stdio servers that exit before startup stabilizes", async () => {
    const { fixturesDirectory, pluginRegistry, gateway } =
      await createGateway();
    const { packageDirectory } = await createPluginPackage(fixturesDirectory, {
      serverScript: `
        process.exit(1);
      `
    });
    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(packageDirectory);

    pluginRegistry.enableInstalledPlugin(installedPlugin.pluginId);

    await expect(
      gateway.startServer("com.engineering-os.mcp-plugin:filesystem")
    ).rejects.toMatchObject({
      code: "MCP_GATEWAY_SERVER_START_FAILED",
      statusCode: 502
    });

    expect(
      gateway.inspectServerHealth("com.engineering-os.mcp-plugin:filesystem")
    ).toMatchObject({
      healthState: "unhealthy"
    });
  });
});
