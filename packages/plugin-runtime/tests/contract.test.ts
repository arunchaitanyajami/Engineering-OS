import { describe, expect, it } from "vitest";

import { pluginRuntimeProtocolVersion } from "@engineering-os/contracts/unstable-runtime";
import {
  createActivatePluginRequestFixture,
  createInitializePluginRequestFixture,
  currentPluginRuntimeProtocolVersion,
  readReferencePluginManifest
} from "@engineering-os/testing";

import {
  assertSupportedProtocolVersion,
  readProtocolVersion
} from "../src/protocol.js";

describe("@engineering-os/plugin-runtime contract compatibility", () => {
  it("uses the shared protocol version fixture", () => {
    expect(currentPluginRuntimeProtocolVersion).toBe(pluginRuntimeProtocolVersion);
    expect(readProtocolVersion({ protocolVersion: "1", type: "health-check" })).toBe(
      "1"
    );
    expect(() =>
      assertSupportedProtocolVersion(currentPluginRuntimeProtocolVersion)
    ).not.toThrow();
  });

  it("accepts initialize and activate requests built from reference manifests", () => {
    const manifest = readReferencePluginManifest("example");

    expect(createInitializePluginRequestFixture(manifest).manifest.id).toBe(
      manifest.id
    );
    expect(createActivatePluginRequestFixture(manifest.id).pluginId).toBe(
      manifest.id
    );
  });
});
