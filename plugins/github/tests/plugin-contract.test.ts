import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { pluginManifestSchema } from "@engineering-os/contracts";
import type { EngineeringOsPlugin } from "@engineering-os/plugin-sdk";

import {
  githubPlugin,
  githubPluginId,
  githubPluginManifest
} from "../src/index.js";

describe("GitHub plugin contract", () => {
  it("exports a Milestone 2 plugin surface with a GitHub-specific identity", () => {
    const plugin: EngineeringOsPlugin = githubPlugin;
    const manifest = pluginManifestSchema.parse(githubPluginManifest);

    expect(plugin.manifest.id).toBe(githubPluginId);
    expect(manifest.id).toBe("com.engineering-os.github");
    expect(
      manifest.permissions.some(
        (permission) => permission.scope === "network.access"
      )
    ).toBe(true);
    expect(manifest.mcp).toHaveLength(1);
    expect(manifest.mcp[0]?.id).toBe("github");
    expect(manifest.capabilities).toContain("mcp-server");
  });

  it("ships the backend and MCP entrypoints required for local registration", () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

    expect(existsSync(join(packageRoot, "dist/backend/index.js"))).toBe(true);
    expect(existsSync(join(packageRoot, "dist/mcp/server.js"))).toBe(true);
  });
});
