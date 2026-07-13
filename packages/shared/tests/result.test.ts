import { describe, expect, it } from "vitest";

import { failure, success, toIsoTimestamp } from "@engineering-os/shared";

describe("shared primitives", () => {
  it("creates success and failure results", () => {
    expect(success("ok")).toEqual({ ok: true, value: "ok" });
    expect(failure("nope")).toEqual({ ok: false, error: "nope" });
  });

  it("serializes ISO timestamps", () => {
    expect(toIsoTimestamp(new Date("2026-01-01T00:00:00.000Z"))).toBe(
      "2026-01-01T00:00:00.000Z"
    );
  });
});
