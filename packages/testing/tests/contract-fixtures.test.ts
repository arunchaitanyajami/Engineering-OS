import { describe, expect, it } from "vitest";

import {
  createActivatePluginRequestFixture,
  createInitializePluginRequestFixture,
  milestone2ReferencePluginIds,
  readReferencePluginManifest
} from "@engineering-os/testing";

describe("Milestone 2 contract fixtures", () => {
  it("loads bundled reference plugin manifests", () => {
    const exampleManifest = readReferencePluginManifest("example");
    const exampleMcpManifest = readReferencePluginManifest("exampleMcp");

    expect(exampleManifest.id).toBe(milestone2ReferencePluginIds.example);
    expect(exampleMcpManifest.id).toBe(milestone2ReferencePluginIds.exampleMcp);
    expect(exampleMcpManifest.capabilities).toContain("mcp-server");
  });

  it("builds plugin runtime RPC fixtures from reference manifests", () => {
    const manifest = readReferencePluginManifest("exampleMcp");

    expect(createInitializePluginRequestFixture(manifest)).toMatchObject({
      type: "initialize-plugin",
      pluginId: manifest.id,
      manifest
    });
    expect(createActivatePluginRequestFixture(manifest.id)).toMatchObject({
      type: "activate-plugin",
      pluginId: manifest.id
    });
  });
});
