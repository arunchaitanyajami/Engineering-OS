import { describe, expect, it } from "vitest";

import {
  pluginManifestSchema,
} from "@engineering-os/contracts";
import {
  mcpServerRegistrationSchema,
  pluginRuntimeProtocolVersion,
  pluginRuntimeRequestSchema,
  toolExecutionRequestSchema
} from "@engineering-os/contracts/unstable-runtime";

const createValidManifest = () => ({
  schemaVersion: "1" as const,
  id: "com.engineering-os.example-mcp",
  name: "Example MCP Plugin",
  version: "0.1.0",
  description: "Reference plugin for Milestone 2 manifest validation.",
  publisher: {
    name: "Engineering OS"
  },
  engines: {
    engineeringOs: ">=0.2.0"
  },
  entrypoints: {
    backend: "./dist/backend/index.js"
  },
  capabilities: ["mcp-server", "settings"] as const,
  permissions: [
    {
      scope: "process.spawn" as const,
      reason: "Starts the bundled MCP server for local reference workflows."
    },
    {
      scope: "mcp.register-server" as const,
      reason: "Registers the plugin-owned MCP server with the gateway."
    },
    {
      scope: "network.access" as const,
      hosts: ["api.example.com"],
      reason: "Reads reference data from the example API host."
    }
  ],
  mcp: [
    {
      id: "example",
      transport: "stdio" as const,
      command: "node",
      args: ["./dist/mcp/server.js"],
      env: {
        EXAMPLE_TOKEN: {
          key: "token"
        }
      }
    }
  ]
});

describe("pluginManifestSchema", () => {
  it("accepts a declarative plugin manifest", () => {
    const result = pluginManifestSchema.safeParse(createValidManifest());

    expect(result.success).toBe(true);
  });

  it("rejects a plugin-supplied verified publisher flag", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      publisher: {
        name: "Engineering OS",
        verified: true
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid semantic version", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      version: "latest"
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid Engineering OS version range", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      engines: {
        engineeringOs: "works on my machine"
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects uppercase plugin identifiers", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      id: "com.Engineering-OS.Example"
    });

    expect(result.success).toBe(false);
  });

  it("rejects absolute backend entrypoints", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      entrypoints: {
        backend: "/Users/example/.ssh/id_rsa"
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects traversal in backend entrypoints", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      entrypoints: {
        backend: "../dist/backend/index.js"
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects frontend entrypoints in schema version 1", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      entrypoints: {
        backend: "./dist/backend/index.js",
        frontend: "./dist/frontend/index.js"
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate MCP server identifiers", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      mcp: [
        ...createValidManifest().mcp,
        {
          id: "example",
          transport: "stdio",
          command: "node",
          args: ["./dist/mcp/server-two.js"]
        }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate permissions", () => {
    const manifest = createValidManifest();
    const result = pluginManifestSchema.safeParse({
      ...manifest,
      permissions: [
        ...manifest.permissions,
        {
          scope: "process.spawn",
          reason: "Attempts to redeclare the same permission scope again."
        }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("rejects MCP declarations without the mcp-server capability", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      capabilities: ["settings"]
    });

    expect(result.success).toBe(false);
  });

  it("rejects MCP declarations without process.spawn", () => {
    const manifest = createValidManifest();
    const result = pluginManifestSchema.safeParse({
      ...manifest,
      permissions: manifest.permissions.filter(
        (permission) => permission.scope !== "process.spawn"
      )
    });

    expect(result.success).toBe(false);
  });

  it("rejects MCP declarations without mcp.register-server", () => {
    const manifest = createValidManifest();
    const result = pluginManifestSchema.safeParse({
      ...manifest,
      permissions: manifest.permissions.filter(
        (permission) => permission.scope !== "mcp.register-server"
      )
    });

    expect(result.success).toBe(false);
  });

  it("rejects arbitrary secret namespaces in plugin MCP environments", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      mcp: [
        {
          id: "example",
          transport: "stdio",
          command: "node",
          args: ["./dist/mcp/server.js"],
          env: {
            EXAMPLE_TOKEN: {
              namespace: "plugins/com.engineering-os.github",
              key: "token"
            }
          }
        }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown unnamespaced permission scopes", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      permissions: [
        {
          scope: "process.spwan",
          reason: "Typo that should fail strict schema validation."
        }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown unnamespaced capabilities", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      capabilities: ["mcp-server", "settings", "custom-capability"]
    });

    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only descriptions", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      description: "   "
    });

    expect(result.success).toBe(false);
  });
});

describe("mcpServerRegistrationSchema", () => {
  it("allows secret references in transport environments", () => {
    const result = mcpServerRegistrationSchema.safeParse({
      id: "github",
      source: {
        type: "plugin",
        pluginId: "com.engineering-os.github"
      },
      name: "GitHub MCP",
      enabled: true,
      transport: {
        type: "stdio",
        command: "node",
        args: ["./dist/server.js"],
        env: {
          GITHUB_TOKEN: {
            namespace: "plugins/com.engineering-os.github",
            key: "token"
          }
        }
      }
    });

    expect(result.success).toBe(true);
  });
});

describe("toolExecutionRequestSchema", () => {
  it("requires an execution actor and correlation context", () => {
    const result = toolExecutionRequestSchema.safeParse({
      toolId: "github.read_pr",
      arguments: {
        owner: "engineering-os",
        repo: "platform",
        pullRequestNumber: 42
      },
      executionContext: {
        actor: {
          type: "agent",
          id: "pr-reviewer"
        },
        correlationId: "corr-123"
      }
    });

    expect(result.success).toBe(true);
  });
});

describe("pluginPermissionRequestSchema", () => {
  it("rejects network permissions without hosts", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      permissions: [
        {
          scope: "network.access",
          reason: "Requests network access without the required host list."
        }
      ],
      mcp: []
    });

    expect(result.success).toBe(false);
  });

  it("rejects filesystem permissions without path constraints", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      permissions: [
        {
          scope: "filesystem.read",
          reason: "Attempts filesystem access without any declared paths."
        }
      ],
      mcp: []
    });

    expect(result.success).toBe(false);
  });

  it("rejects hosts on non-network permissions", () => {
    const result = pluginManifestSchema.safeParse({
      ...createValidManifest(),
      permissions: [
        {
          scope: "clipboard.read",
          hosts: ["api.example.com"],
          reason: "Attaches host constraints to a clipboard permission."
        }
      ],
      mcp: []
    });

    expect(result.success).toBe(false);
  });
});

describe("pluginRuntimeRequestSchema", () => {
  it("accepts initialize requests with the parsed manifest", () => {
    const manifest = pluginManifestSchema.parse({
      ...createValidManifest(),
      id: "com.engineering-os.example.plugin",
      capabilities: ["settings"],
      permissions: [],
      mcp: []
    });

    const result = pluginRuntimeRequestSchema.safeParse({
      protocolVersion: pluginRuntimeProtocolVersion,
      type: "initialize-plugin",
      requestId: "req-1",
      pluginId: manifest.id,
      installationRootPath: "/managed/plugins/com.engineering-os.example.plugin/0.1.0",
      expectedContentHash:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      manifest
    });

    expect(result.success).toBe(true);
  });
});
