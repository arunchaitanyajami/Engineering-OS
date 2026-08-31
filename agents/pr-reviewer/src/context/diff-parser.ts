import {
  fileDiffSchema,
  type ChangedFile,
  type ChangedFileStatus,
  type DiffHunk,
  type DiffLine,
  type FileDiff
} from "@engineering-os/source-control-domain";

export class DiffParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiffParseError";
  }
}

const hunkHeaderPattern =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?$/;
const gitHeaderPattern =
  /^(diff --git |index |similarity index |dissimilarity index |rename |copy |new file mode |deleted file mode |old mode |new mode |Binary files |GIT binary patch)/;
const noNewlinePattern = /^\\ No newline at end of file$/;

const stripDiffPathPrefix = (value: string): string => {
  const trimmed = value.trim().replace(/^[ab]\//, "");

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const splitPatchLines = (patch: string): string[] => {
  const lines = patch.split(/\r?\n/);

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
};

const parseHunkHeader = (
  line: string
): {
  readonly oldStart: number;
  readonly oldLineCount: number;
  readonly newStart: number;
  readonly newLineCount: number;
  readonly sectionHeading?: string;
} => {
  const match = hunkHeaderPattern.exec(line);

  if (!match) {
    throw new DiffParseError(`Invalid unified diff hunk header: ${line}`);
  }

  const sectionHeading = match[5]?.trim();

  return {
    oldStart: Number(match[1]),
    oldLineCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newLineCount: match[4] === undefined ? 1 : Number(match[4]),
    ...(sectionHeading ? { sectionHeading } : {})
  };
};

const toLineKind = (prefix: string): DiffLine["kind"] => {
  switch (prefix) {
    case " ":
      return "context";
    case "+":
      return "addition";
    case "-":
      return "deletion";
    default:
      throw new DiffParseError(
        `Unsupported unified diff line prefix '${prefix}'.`
      );
  }
};

const parseHunks = (lines: readonly string[]): DiffHunk[] => {
  const hunks: DiffHunk[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line) {
      index += 1;
      continue;
    }

    if (
      gitHeaderPattern.test(line) ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      index += 1;
      continue;
    }

    if (!line.startsWith("@@ ")) {
      throw new DiffParseError(`Unexpected unified diff line: ${line}`);
    }

    const header = parseHunkHeader(line);
    index += 1;
    const hunkLines: DiffLine[] = [];
    let oldCursor = header.oldStart;
    let newCursor = header.newStart;

    while (index < lines.length) {
      const hunkLine = lines[index];

      if (hunkLine === undefined) {
        break;
      }

      if (hunkLine.startsWith("@@ ")) {
        break;
      }

      if (
        gitHeaderPattern.test(hunkLine) ||
        hunkLine.startsWith("diff --git ")
      ) {
        break;
      }

      if (noNewlinePattern.test(hunkLine)) {
        const previous = hunkLines.at(-1);

        if (previous) {
          hunkLines[hunkLines.length - 1] = {
            ...previous,
            noNewlineAtEnd: true
          };
        }

        index += 1;
        continue;
      }

      if (hunkLine.length === 0) {
        index += 1;
        continue;
      }

      const kind = toLineKind(hunkLine[0] ?? "");
      const parsedLine: DiffLine = {
        kind,
        content: hunkLine.slice(1),
        ...(kind !== "addition" && oldCursor > 0
          ? { oldLineNumber: oldCursor }
          : {}),
        ...(kind !== "deletion" && newCursor > 0
          ? { newLineNumber: newCursor }
          : {})
      };

      hunkLines.push(parsedLine);

      if (kind !== "addition" && oldCursor > 0) {
        oldCursor += 1;
      }

      if (kind !== "deletion" && newCursor > 0) {
        newCursor += 1;
      }

      index += 1;
    }

    hunks.push({
      oldStart: header.oldStart,
      oldLineCount: header.oldLineCount,
      newStart: header.newStart,
      newLineCount: header.newLineCount,
      ...(header.sectionHeading
        ? { sectionHeading: header.sectionHeading }
        : {}),
      lines: hunkLines
    });
  }

  return hunks;
};

const countHunkChanges = (
  hunks: readonly DiffHunk[]
): { readonly additions: number; readonly deletions: number } =>
  hunks.reduce(
    (counts, hunk) => ({
      additions:
        counts.additions +
        hunk.lines.filter((line) => line.kind === "addition").length,
      deletions:
        counts.deletions +
        hunk.lines.filter((line) => line.kind === "deletion").length
    }),
    { additions: 0, deletions: 0 }
  );

const inferStatus = (input: {
  readonly status?: ChangedFileStatus;
  readonly previousPath?: string;
  readonly oldFilePath?: string;
  readonly newFilePath?: string;
  readonly binaryMarker?: boolean;
}): ChangedFileStatus => {
  if (input.status) {
    return input.status;
  }

  if (input.previousPath) {
    return "renamed";
  }

  if (!input.oldFilePath && input.newFilePath) {
    return "added";
  }

  if (input.oldFilePath && !input.newFilePath) {
    return "deleted";
  }

  return input.binaryMarker ? "modified" : "modified";
};

const toFileDiff = (input: {
  readonly path: string;
  readonly previousPath?: string;
  readonly oldFilePath?: string;
  readonly newFilePath?: string;
  readonly status?: ChangedFileStatus;
  readonly binary: boolean;
  readonly additions?: number;
  readonly deletions?: number;
  readonly hunks: readonly DiffHunk[];
}): FileDiff => {
  const hunkChanges = countHunkChanges(input.hunks);
  const status = inferStatus(input);

  return fileDiffSchema.parse({
    path: input.path,
    ...(input.previousPath ? { previousPath: input.previousPath } : {}),
    ...(input.oldFilePath ? { oldFilePath: input.oldFilePath } : {}),
    ...(input.newFilePath ? { newFilePath: input.newFilePath } : {}),
    status,
    binary: input.binary,
    additions: input.additions ?? hunkChanges.additions,
    deletions: input.deletions ?? hunkChanges.deletions,
    hunks: input.hunks
  });
};

export const parseChangedFileDiff = (file: ChangedFile): FileDiff => {
  const hunks =
    file.binary || file.patch === undefined || file.patch.trim().length === 0
      ? []
      : parseHunks(splitPatchLines(file.patch));

  return toFileDiff({
    path: file.path,
    ...(file.previousPath ? { previousPath: file.previousPath } : {}),
    ...(file.status === "added"
      ? {}
      : { oldFilePath: file.previousPath ?? file.path }),
    ...(file.status === "deleted" ? {} : { newFilePath: file.path }),
    status: file.status,
    binary: file.binary,
    additions: file.additions,
    deletions: file.deletions,
    hunks
  });
};

const parseGitFilePath = (
  line: string,
  marker: "--- " | "+++ "
): string | null => {
  const value = stripDiffPathPrefix(line.slice(marker.length));

  if (value === "/dev/null") {
    return null;
  }

  return value;
};

export const parseUnifiedDiff = (patch: string): FileDiff[] => {
  const lines = splitPatchLines(patch);

  if (lines.length === 0) {
    return [];
  }

  if (!lines.some((line) => line.startsWith("diff --git "))) {
    throw new DiffParseError(
      "A multi-file unified diff must include diff --git headers. Use parseChangedFileDiff for GitHub file patches."
    );
  }

  const files: FileDiff[] = [];
  let current: {
    path: string;
    previousPath?: string;
    oldFilePath?: string | null;
    newFilePath?: string | null;
    status?: ChangedFileStatus;
    binary: boolean;
    body: string[];
  } | null = null;

  const flush = () => {
    if (!current) {
      return;
    }

    const path = current.newFilePath ?? current.oldFilePath ?? current.path;

    files.push(
      toFileDiff({
        path,
        ...(current.previousPath ? { previousPath: current.previousPath } : {}),
        ...(current.oldFilePath ? { oldFilePath: current.oldFilePath } : {}),
        ...(current.newFilePath ? { newFilePath: current.newFilePath } : {}),
        ...(current.status ? { status: current.status } : {}),
        binary: current.binary,
        hunks: current.binary ? [] : parseHunks(current.body)
      })
    );
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      const parts = line.slice("diff --git ".length).split(" ");
      const right = stripDiffPathPrefix(parts.at(-1) ?? "file");
      current = {
        path: right,
        binary: false,
        body: []
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("rename from ")) {
      current.previousPath = line.slice("rename from ".length).trim();
      current.status = "renamed";
      continue;
    }

    if (line.startsWith("rename to ")) {
      current.path = line.slice("rename to ".length).trim();
      current.newFilePath = current.path;
      current.status = "renamed";
      continue;
    }

    if (line.startsWith("new file mode ")) {
      current.status = "added";
      continue;
    }

    if (line.startsWith("deleted file mode ")) {
      current.status = "deleted";
      continue;
    }

    if (
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch")
    ) {
      current.binary = true;
      continue;
    }

    if (line.startsWith("--- ")) {
      current.oldFilePath = parseGitFilePath(line, "--- ");
      continue;
    }

    if (line.startsWith("+++ ")) {
      current.newFilePath = parseGitFilePath(line, "+++ ");
      if (current.newFilePath) {
        current.path = current.newFilePath;
      }
      continue;
    }

    current.body.push(line);
  }

  flush();
  return files;
};
