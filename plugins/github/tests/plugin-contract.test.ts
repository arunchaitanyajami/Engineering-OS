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
});
