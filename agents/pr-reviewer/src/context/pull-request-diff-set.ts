import type {
  ChangedFile,
  FileDiff
} from "@engineering-os/source-control-domain";

import { parseChangedFileDiff } from "./diff-parser.js";
import {
  applyFileReviewPolicy,
  type FileReviewPolicyOptions,
  type FileReviewResult
} from "./file-review-policy.js";

export interface PullRequestDiffSet {
  readonly files: readonly ChangedFile[];
  readonly diffs: readonly FileDiff[];
  readonly decisions: readonly FileReviewResult[];
}

export const buildPullRequestDiffSet = (
  files: readonly ChangedFile[],
  options: FileReviewPolicyOptions = {}
): PullRequestDiffSet => ({
  files,
  diffs: files.map(parseChangedFileDiff),
  decisions: applyFileReviewPolicy(files, options)
});
