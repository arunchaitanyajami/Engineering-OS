const SAMPLE_RESOURCES = [
  {
    uri: "sample://docs/getting-started",
    name: "Getting Started",
    description: "Introductory reference content for the example MCP plugin.",
    mimeType: "text/markdown",
    text: "# Getting Started\n\nInstall this plugin from the Plugins screen to validate MCP gateway behavior."
  },
  {
    uri: "sample://docs/plugin-overview",
    name: "Plugin Overview",
    description: "Overview of plugin and MCP boundaries in Engineering OS.",
    mimeType: "text/markdown",
    text: "# Plugin Overview\n\nPlugins declare MCP servers in their manifest. The gateway manages stdio processes."
  }
];

const TOOLS = [
  {
    name: "echo",
    title: "Echo",
    description: "Returns the supplied message unchanged.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Message to echo back to the caller."
        }
      },
      required: ["message"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: "get_current_workspace_info",
    title: "Current Workspace Info",
    description: "Returns safe local workspace metadata for the MCP server process.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: "list_sample_resources",
    title: "List Sample Resources",
    description: "Lists bundled sample resources exposed by the reference MCP plugin.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true
    }
  },
  {
    name: "read_sample_resource",
    title: "Read Sample Resource",
    description: "Reads a bundled sample resource by URI.",
    inputSchema: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description: "Sample resource URI returned by list_sample_resources."
        }
      },
      required: ["uri"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true
    }
  }
];

let buffer = "";

const writeMessage = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const findSampleResource = (uri) =>
  SAMPLE_RESOURCES.find((resource) => resource.uri === uri) ?? null;

const handleToolCall = (message) => {
  const toolName = message.params?.name;
  const toolArguments = message.params?.arguments ?? {};

  switch (toolName) {
    case "echo": {
      const echoedMessage =
        typeof toolArguments.message === "string"
          ? toolArguments.message
          : String(toolArguments.message ?? "");

      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: echoedMessage
            }
          ],
          structuredContent: {
            message: echoedMessage
          }
        }
      });
      return;
    }
    case "get_current_workspace_info": {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  cwd: process.cwd(),
                  nodeVersion: process.version,
                  platform: process.platform,
                  arch: process.arch
                },
                null,
                2
              )
            }
          ],
          structuredContent: {
            cwd: process.cwd(),
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch
          }
        }
      });
      return;
    }
    case "list_sample_resources": {
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                SAMPLE_RESOURCES.map(({ uri, name, description, mimeType }) => ({
                  uri,
                  name,
                  description,
                  mimeType
                })),
                null,
                2
              )
            }
          ],
          structuredContent: {
            resources: SAMPLE_RESOURCES.map(
              ({ uri, name, description, mimeType }) => ({
                uri,
                name,
                description,
                mimeType
              })
            )
          }
        }
      });
      return;
    }
    case "read_sample_resource": {
      const uri =
        typeof toolArguments.uri === "string" ? toolArguments.uri.trim() : "";
      const resource = findSampleResource(uri);

      if (!resource) {
        writeMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [
              {
                type: "text",
                text: `Unknown sample resource: ${uri || "(missing uri)"}`
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
              text: resource.text
            }
          ],
          structuredContent: {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.text
          }
        }
      });
      return;
    }
    default:
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Unknown tool: ${String(toolName)}`
        }
      });
  }
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
            resources: {}
          },
          serverInfo: {
            name: "example-mcp-plugin",
            version: "0.1.0"
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
          tools: TOOLS
        }
      });
      return;
    case "tools/call":
      handleToolCall(message);
      return;
    case "resources/list":
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          resources: SAMPLE_RESOURCES.map(
            ({ uri, name, description, mimeType }) => ({
              uri,
              name,
              description,
              mimeType
            })
          )
        }
      });
      return;
    case "resources/read": {
      const uri = message.params?.uri;
      const resource =
        typeof uri === "string" ? findSampleResource(uri.trim()) : null;

      if (!resource) {
        writeMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32602,
            message: `Unknown resource URI: ${String(uri)}`
          }
        });
        return;
      }

      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          contents: [
            {
              uri: resource.uri,
              mimeType: resource.mimeType,
              text: resource.text
            }
          ]
        }
      });
      return;
    }
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
    const newlineIndex = buffer.indexOf("\n");

    if (newlineIndex === -1) {
      break;
    }

    const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
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
