import { describe, expect, it } from "vitest";

import { MAX_RUNTIME_MESSAGE_BYTES } from "@engineering-os/contracts/unstable-runtime";

import {
  assertIpcMessageWithinLimit,
  estimateIpcMessageBytes
} from "../src/ipc-message-size.js";

describe("ipc message size guards", () => {
  it("accepts messages within the runtime IPC limit", () => {
    expect(() =>
      assertIpcMessageWithinLimit(
        { type: "health-check", requestId: "req-1" },
        "test message"
      )
    ).not.toThrow();
  });

  it("rejects messages that exceed the runtime IPC limit", () => {
    const oversizedMessage = {
      type: "invoke-plugin-capability",
      payload: "x".repeat(MAX_RUNTIME_MESSAGE_BYTES)
    };

    expect(estimateIpcMessageBytes(oversizedMessage)).toBeGreaterThan(
      MAX_RUNTIME_MESSAGE_BYTES
    );
    expect(() =>
      assertIpcMessageWithinLimit(oversizedMessage, "test message")
    ).toThrow(/exceeds the maximum IPC message size/);
  });
});
