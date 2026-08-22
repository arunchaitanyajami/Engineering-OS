import { describe, expect, it } from "vitest";

import { pluginRuntimeProtocolVersion } from "@engineering-os/contracts/unstable-runtime";

import {
  assertSupportedProtocolVersion,
  PluginRuntimeProtocolError,
  readProtocolVersion
} from "../src/protocol.js";

describe("plugin runtime protocol validation", () => {
  it("reads protocolVersion from runtime messages", () => {
    expect(readProtocolVersion({ protocolVersion: "1", type: "health-check" })).toBe(
      "1"
    );
    expect(readProtocolVersion({ type: "health-check" })).toBe(undefined);
  });

  it("accepts the current protocol version", () => {
    expect(() =>
      assertSupportedProtocolVersion(pluginRuntimeProtocolVersion)
    ).not.toThrow();
  });

  it("rejects unsupported protocol versions", () => {
    expect(() => assertSupportedProtocolVersion("99")).toThrow(
      PluginRuntimeProtocolError
    );
  });
});
