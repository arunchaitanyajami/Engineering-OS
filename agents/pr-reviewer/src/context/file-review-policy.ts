import type { ChangedFile } from "@engineering-os/source-control-domain";

export const fileReviewSkipReasons = [
  "binary",
  "generated-file",
  "lockfile",
  "vendored",
  "minified",
  "snapshot",
  "budget",
  "unsupported"
] as const;

export type FileReviewSkipReason = (typeof fileReviewSkipReasons)[number];

export interface FileReviewDecision {
  readonly include: boolean;
  readonly reason?: FileReviewSkipReason;
}

export interface FileReviewPolicyOptions {
  readonly maxReviewableFiles?: number;
}

export interface FileReviewResult {
  readonly file: ChangedFile;
  readonly decision: FileReviewDecision;
}

const lockfileNames = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "pipfile.lock",
  "go.sum",
  "flake.lock"
]);

const binaryExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "pdf",
  "zip",
  "gz",
  "tgz",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "wasm",
  "mp4",
  "mp3",
  "mov",
  "bin"
]);

const basename = (path: string): string => {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
};

const extension = (path: string): string => {
  const name = basename(path);
  const separator = name.lastIndexOf(".");

  if (separator <= 0) {
    return "";
  }

  return name.slice(separator + 1).toLowerCase();
};

const matchesPath = (path: string, pattern: RegExp): boolean =>
  pattern.test(path.replaceAll("\\", "/"));

const skip = (reason: FileReviewSkipReason): FileReviewDecision => ({
  include: false,
  reason
});

export const evaluateFileReviewPolicy = (
  file: ChangedFile
): FileReviewDecision => {
  const path = file.path.replaceAll("\\", "/");

  if (file.binary || binaryExtensions.has(extension(path))) {
    return skip("binary");
  }

  if (lockfileNames.has(basename(path).toLowerCase())) {
    return skip("lockfile");
  }

  if (matchesPath(path, /(^|\/)(vendor|third_party|node_modules|Pods)(\/|$)/)) {
    return skip("vendored");
  }

  if (matchesPath(path, /\.min\.(js|mjs|cjs|css)$/i)) {
    return skip("minified");
  }

  if (
    matchesPath(path, /(^|\/)(__generated__|generated)(\/|$)/) ||
    matchesPath(path, /\.(generated|gen|pb)\.[^.]+$/i)
  ) {
    return skip("generated-file");
  }

  if (
    matchesPath(path, /(^|\/)__snapshots__(\/|$)/) ||
    path.endsWith(".snap")
  ) {
    return skip("snapshot");
  }

  return { include: true };
};

export const applyFileReviewPolicy = (
  files: readonly ChangedFile[],
  options: FileReviewPolicyOptions = {}
): readonly FileReviewResult[] => {
  const evaluated = files.map((file) => ({
    file,
    decision: evaluateFileReviewPolicy(file)
  }));

  const maxReviewableFiles = options.maxReviewableFiles;

  if (maxReviewableFiles === undefined) {
    return evaluated;
  }

  let includedCount = 0;

  return evaluated.map((result) => {
    if (!result.decision.include) {
      return result;
    }

    if (includedCount >= maxReviewableFiles) {
      return {
        file: result.file,
        decision: skip("budget")
      };
    }

    includedCount += 1;
    return result;
  });
};
