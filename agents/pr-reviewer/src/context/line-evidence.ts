import type {
  DiffLine,
  FileDiff,
  FindingEvidence
} from "@engineering-os/source-control-domain";

export type DiffLineSide = "old" | "new";

export interface DiffLineQuery {
  readonly side: DiffLineSide;
  readonly line: number;
}

export type LineEvidenceMapping =
  | {
      readonly ok: true;
      readonly file: FileDiff;
      readonly side: DiffLineSide;
      readonly lines: readonly DiffLine[];
    }
  | {
      readonly ok: false;
      readonly reason:
        "file-not-changed" | "line-not-in-diff" | "invalid-range";
    };

const matchesEvidencePath = (diff: FileDiff, filePath: string): boolean =>
  diff.path === filePath ||
  diff.previousPath === filePath ||
  diff.oldFilePath === filePath ||
  diff.newFilePath === filePath;

export const findDiffLine = (
  diff: FileDiff,
  query: DiffLineQuery
): DiffLine | null => {
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      const lineNumber =
        query.side === "old" ? line.oldLineNumber : line.newLineNumber;

      if (lineNumber === query.line) {
        return line;
      }
    }
  }

  return null;
};

export const evidenceSideForDiff = (diff: FileDiff): DiffLineSide =>
  diff.status === "deleted" ? "old" : "new";

const collectRange = (
  diff: FileDiff,
  side: DiffLineSide,
  startLine: number,
  endLine: number
): DiffLine[] | null => {
  const mapped: DiffLine[] = [];

  for (let line = startLine; line <= endLine; line += 1) {
    const found = findDiffLine(diff, { side, line });

    if (!found) {
      return null;
    }

    mapped.push(found);
  }

  return mapped;
};

export const mapLineEvidence = (
  diffs: readonly FileDiff[],
  evidence: Pick<FindingEvidence, "filePath" | "startLine" | "endLine">
): LineEvidenceMapping => {
  const file = diffs.find((diff) =>
    matchesEvidencePath(diff, evidence.filePath)
  );

  if (!file) {
    return { ok: false, reason: "file-not-changed" };
  }

  if (evidence.startLine === undefined && evidence.endLine === undefined) {
    return { ok: true, file, side: evidenceSideForDiff(file), lines: [] };
  }

  const startLine = evidence.startLine ?? evidence.endLine;
  const endLine = evidence.endLine ?? evidence.startLine;

  if (startLine === undefined || endLine === undefined || endLine < startLine) {
    return { ok: false, reason: "invalid-range" };
  }

  const side = evidenceSideForDiff(file);
  const lines = collectRange(file, side, startLine, endLine);

  if (!lines) {
    return { ok: false, reason: "line-not-in-diff" };
  }

  return { ok: true, file, side, lines };
};
