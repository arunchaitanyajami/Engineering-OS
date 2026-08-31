import { describe, expect, it } from "vitest";

import type { ChangedFile } from "@engineering-os/source-control-domain";

import {
  applyFileReviewPolicy,
  evaluateFileReviewPolicy
} from "../src/context/file-review-policy.js";

const file = (
  path: string,
  overrides: Partial<ChangedFile> = {}
): ChangedFile => ({
  path,
  status: "modified",
  additions: 1,
  deletions: 0,
  binary: false,
  ...overrides
});

describe("evaluateFileReviewPolicy", () => {
  it("includes normal source files", () => {
    expect(evaluateFileReviewPolicy(file("src/checkout/totals.ts"))).toEqual({
      include: true
    });
  });

  it("excludes binary files and records the reason", () => {
    expect(
      evaluateFileReviewPolicy(file("docs/diagram.png", { binary: true }))
    ).toEqual({ include: false, reason: "binary" });
    expect(evaluateFileReviewPolicy(file("assets/logo.webp"))).toEqual({
      include: false,
      reason: "binary"
    });
  });

  it("excludes lockfiles", () => {
    expect(evaluateFileReviewPolicy(file("pnpm-lock.yaml"))).toEqual({
      include: false,
      reason: "lockfile"
    });
    expect(
      evaluateFileReviewPolicy(file("apps/web/package-lock.json"))
    ).toEqual({
      include: false,
      reason: "lockfile"
    });
  });

  it("excludes generated files", () => {
    expect(
      evaluateFileReviewPolicy(file("src/api/schema.generated.ts"))
    ).toEqual({ include: false, reason: "generated-file" });
    expect(
      evaluateFileReviewPolicy(file("src/__generated__/types.ts"))
    ).toEqual({ include: false, reason: "generated-file" });
  });

  it("excludes minified files", () => {
    expect(evaluateFileReviewPolicy(file("public/app.min.js"))).toEqual({
      include: false,
      reason: "minified"
    });
  });

  it("excludes vendored dependencies", () => {
    expect(evaluateFileReviewPolicy(file("vendor/jquery.js"))).toEqual({
      include: false,
      reason: "vendored"
    });
  });

  it("handles snapshot files", () => {
    expect(
      evaluateFileReviewPolicy(
        file("src/components/__snapshots__/button.test.tsx.snap")
      )
    ).toEqual({ include: false, reason: "snapshot" });
  });
});

describe("applyFileReviewPolicy", () => {
  it("applies budget exclusion after default includes", () => {
    const results = applyFileReviewPolicy(
      [
        file("src/a.ts"),
        file("pnpm-lock.yaml"),
        file("src/b.ts"),
        file("src/c.ts")
      ],
      { maxReviewableFiles: 1 }
    );

    expect(results.map((result) => result.decision)).toEqual([
      { include: true },
      { include: false, reason: "lockfile" },
      { include: false, reason: "budget" },
      { include: false, reason: "budget" }
    ]);
  });
});
