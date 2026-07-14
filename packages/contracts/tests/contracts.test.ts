import { describe, expect, it } from "vitest";

import {
  mcpServerRegistrationSchema,
  pluginManifestSchema,
  pluginRuntimeRequestSchema,
  toolExecutionRequestSchema
} from "@engineering-os/contracts";

describe("pluginManifestSchema", () => {
  it("accepts a declarative plugin manifest", () => {
    const result = pluginManifestSchema.safeParse({
      schemaVersion: "1",
      id: "com.engineering-os.example-mcp",
      name: "Example MCP Plugin",
      version: "0.1.0",
      description: "Reference plugin for Milestone 2",
      publisher: {
        name: "Engineering OS",
        verified: true
      },
      engines: {
        engineeringOs: ">=0.2.0"
      },
      entrypoints: {
        backend: "./dist/backend/index.js"
      },
      capabilities: ["mcp-server", "settings"],
      permissions: [
        {
          scope: "process.spawn",
          reason: "Starts the bundled MCP server"
        },
        {
          scope: "network.access",
          hosts: ["api.example.com"],
          reason: "Reads reference data"
        }
      ],
      mcp: [
        {
          id: "example",
          transport: "stdio",
          command: "node",
          args: ["./dist/mcp/server.js"]
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects a manifest without any entrypoints", () => {
    const result = pluginManifestSchema.safeParse({
      schemaVersion: "1",
      id: "com.engineering-os.invalid",
      name: "Invalid Plugin",
      version: "0.1.0",
      description: "Missing entrypoints",
      publisher: {
        name: "Engineering OS",
        verified: false
      },
      engines: {
        engineeringOs: ">=0.2.0"
      },
      entrypoints: {},
      capabilities: [],
      permissions: [],
      mcp: []
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

describe("pluginRuntimeRequestSchema", () => {
  it("accepts initialize requests with the parsed manifest", () => {
    const manifest = pluginManifestSchema.parse({
      schemaVersion: "1",
      id: "com.engineering-os.example",
      name: "Example Plugin",
      version: "0.1.0",
      description: "Reference plugin",
      publisher: {
        name: "Engineering OS",
        verified: true
      },
      engines: {
        engineeringOs: ">=0.2.0"
      },
      entrypoints: {
        backend: "./dist/backend/index.js"
      },
      capabilities: ["settings"],
      permissions: [],
      mcp: []
    });

    const result = pluginRuntimeRequestSchema.safeParse({
      type: "initialize-plugin",
      requestId: "req-1",
      pluginId: manifest.id,
      manifest
    });

    expect(result.success).toBe(true);
  });
});
