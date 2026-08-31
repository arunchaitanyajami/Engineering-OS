import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ChangedFile } from "@engineering-os/source-control-domain";

import {
  DiffParseError,
  parseChangedFileDiff,
  parseUnifiedDiff
} from "../src/context/diff-parser.js";
import { findDiffLine, mapLineEvidence } from "../src/context/line-evidence.js";

const fixturesDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

const readFixture = (name: string): string =>
  readFileSync(join(fixturesDirectory, name), "utf8");

const changedFile = (
  overrides: Partial<ChangedFile> & Pick<ChangedFile, "path" | "status">
): ChangedFile => ({
  additions: 0,
  deletions: 0,
  binary: false,
  ...overrides
});

describe("parseChangedFileDiff", () => {
  it("maps context and addition lines for one changed file", () => {
    const diff = parseChangedFileDiff(
      changedFile({
        path: "src/checkout/totals.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: readFixture("one-changed-file.patch")
      })
    );

    expect(diff.hunks).toHaveLength(1);
    expect(findDiffLine(diff, { side: "new", line: 2 })).toMatchObject({
      kind: "addition",
      content: "export const tax = 1;",
      newLineNumber: 2
    });
    expect(findDiffLine(diff, { side: "old", line: 2 })).toMatchObject({
      kind: "context",
      content: "export const total = 2;",
      oldLineNumber: 2,
      newLineNumber: 3
    });
  });

  it("maps multiple hunks without drifting line numbers", () => {
    const diff = parseChangedFileDiff(
      changedFile({
        path: "src/multi.ts",
        status: "modified",
        patch: readFixture("multiple-hunks.patch")
      })
    );

    expect(diff.hunks).toHaveLength(2);
    expect(findDiffLine(diff, { side: "new", line: 2 })?.kind).toBe("addition");
    expect(findDiffLine(diff, { side: "new", line: 23 })?.content).toBe(
      "const addedLater = 22;"
    );
    expect(findDiffLine(diff, { side: "old", line: 23 })?.content).toBe(
      "const end = 24;"
    );
  });

  it("maps a new file from a zero old-start hunk", () => {
    const diff = parseChangedFileDiff(
      changedFile({
        path: "src/new-file.ts",
        status: "added",
        additions: 3,
        patch: readFixture("new-file.patch")
      })
    );

    expect(diff.hunks[0]?.oldStart).toBe(0);
    expect(findDiffLine(diff, { side: "old", line: 1 })).toBeNull();
    expect(findDiffLine(diff, { side: "new", line: 1 })).toMatchObject({
      kind: "addition",
      newLineNumber: 1
    });
  });

  it("maps a deleted file onto old line numbers", () => {
    const diff = parseChangedFileDiff(
      changedFile({
        path: "src/removed.ts",
        status: "deleted",
        deletions: 3,
        patch: readFixture("deleted-file.patch")
      })
    );

    expect(diff.hunks[0]?.newStart).toBe(0);
    expect(findDiffLine(diff, { side: "new", line: 1 })).toBeNull();
    expect(findDiffLine(diff, { side: "old", line: 2 })).toMatchObject({
      kind: "deletion",
      content: "export const stale = true;"
    });
  });

  it("keeps rename paths and maps the new-file side", () => {
    const diff = parseChangedFileDiff(
      changedFile({
        path: "src/checkout/totals.ts",
        previousPath: "src/checkout/sum.ts",
        status: "renamed",
        additions: 1,
        patch: readFixture("one-changed-file.patch")
      })
    );

    expect(diff.previousPath).toBe("src/checkout/sum.ts");
    expect(diff.oldFilePath).toBe("src/checkout/sum.ts");
    expect(diff.newFilePath).toBe("src/checkout/totals.ts");
    expect(
      mapLineEvidence([diff], {
        filePath: "src/checkout/sum.ts",
        startLine: 2,
        endLine: 2
      }).ok
    ).toBe(true);
  });

  it("returns no hunks for a binary file", () => {
    const diff = parseChangedFileDiff(
      changedFile({
        path: "docs/diagram.png",
        status: "added",
        binary: true
      })
    );

    expect(diff.binary).toBe(true);
    expect(diff.hunks).toEqual([]);
  });

  it("returns no hunks for an empty patch", () => {
    const diff = parseChangedFileDiff(
      changedFile({
        path: "src/empty.ts",
        status: "modified",
        patch: ""
      })
    );

    expect(diff.hunks).toEqual([]);
  });

  it("records no-newline markers on the affected line", () => {
    const diff = parseChangedFileDiff(
      changedFile({
        path: "src/value.ts",
        status: "modified",
        patch: readFixture("no-newline.patch")
      })
    );

    expect(findDiffLine(diff, { side: "new", line: 1 })).toMatchObject({
      kind: "addition",
      noNewlineAtEnd: true
    });
  });

  it("honors unusual hunk offsets", () => {
    const diff = parseChangedFileDiff(
      changedFile({
        path: "src/offset.ts",
        status: "modified",
        patch: readFixture("unusual-offsets.patch")
      })
    );

    expect(diff.hunks[0]).toMatchObject({
      oldStart: 100,
      newStart: 250
    });
    expect(findDiffLine(diff, { side: "new", line: 252 })?.content).toBe(
      "const inserted = 102;"
    );
    expect(findDiffLine(diff, { side: "old", line: 103 })?.content).toBe(
      "const end = 104;"
    );
  });

  it("maps a large diff without losing sequential new-line numbers", () => {
    const additions = Array.from(
      { length: 400 },
      (_, index) => `+export const value${index} = ${index};`
    );
    const diff = parseChangedFileDiff(
      changedFile({
        path: "src/large.ts",
        status: "added",
        additions: 400,
        patch: `@@ -0,0 +1,400 @@\n${additions.join("\n")}\n`
      })
    );

    expect(diff.hunks[0]?.lines).toHaveLength(400);
    expect(findDiffLine(diff, { side: "new", line: 1 })?.newLineNumber).toBe(1);
    expect(findDiffLine(diff, { side: "new", line: 400 })?.newLineNumber).toBe(
      400
    );
  });
});

describe("parseUnifiedDiff", () => {
  it("parses multiple files from a git unified diff", () => {
    const diffs = parseUnifiedDiff(readFixture("multiple-files.patch"));

    expect(diffs.map((diff) => diff.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(findDiffLine(diffs[0]!, { side: "new", line: 2 })?.kind).toBe(
      "addition"
    );
  });

  it("parses renamed files from git headers", () => {
    const [diff] = parseUnifiedDiff(readFixture("renamed-file.patch"));

    expect(diff).toMatchObject({
      path: "src/checkout/totals.ts",
      previousPath: "src/checkout/sum.ts",
      status: "renamed"
    });
  });

  it("parses binary git diffs without inventing hunks", () => {
    const [diff] = parseUnifiedDiff(readFixture("binary-file.patch"));

    expect(diff).toMatchObject({
      path: "docs/diagram.png",
      binary: true,
      hunks: []
    });
  });

  it("returns no files for an empty patch", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("rejects GitHub-style hunks without git headers", () => {
    expect(() =>
      parseUnifiedDiff(readFixture("one-changed-file.patch"))
    ).toThrow(DiffParseError);
  });
});

describe("mapLineEvidence", () => {
  it("maps new-file evidence onto parsed addition lines", () => {
    const diff = parseChangedFileDiff(
      changedFile({
        path: "src/new-file.ts",
        status: "added",
        patch: readFixture("new-file.patch")
      })
    );

    const mapping = mapLineEvidence([diff], {
      filePath: "src/new-file.ts",
      startLine: 1,
      endLine: 3
    });

    expect(mapping.ok).toBe(true);
    if (mapping.ok) {
      expect(mapping.side).toBe("new");
      expect(mapping.lines.map((line) => line.newLineNumber)).toEqual([
        1, 2, 3
      ]);
    }
  });

  it("rejects evidence that is not in the changed diff", () => {
    const diff = parseChangedFileDiff(
      changedFile({
        path: "src/new-file.ts",
        status: "added",
        patch: readFixture("new-file.patch")
      })
    );

    expect(
      mapLineEvidence([diff], {
        filePath: "src/new-file.ts",
        startLine: 9,
        endLine: 9
      })
    ).toEqual({ ok: false, reason: "line-not-in-diff" });
    expect(
      mapLineEvidence([diff], {
        filePath: "src/other.ts",
        startLine: 1
      })
    ).toEqual({ ok: false, reason: "file-not-changed" });
  });
});
