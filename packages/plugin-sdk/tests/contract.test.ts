import { describe, expect, it } from "vitest";

import type { EngineeringOsPlugin } from "@engineering-os/plugin-sdk";
import {
  milestone2ReferencePluginIds,
  readReferencePluginManifest
} from "@engineering-os/testing";

describe("@engineering-os/plugin-sdk contract compatibility", () => {
  it("accepts reference manifest shapes through the plugin author surface", () => {
    const manifest = readReferencePluginManifest("exampleMcp");

    const plugin: EngineeringOsPlugin = {
      manifest,
      async initialize() {},
      async activate() {},
      async deactivate() {},
      async dispose() {}
    };

    expect(plugin.manifest.id).toBe(milestone2ReferencePluginIds.exampleMcp);
    expect(plugin.manifest.mcp).toHaveLength(1);
  });
});
