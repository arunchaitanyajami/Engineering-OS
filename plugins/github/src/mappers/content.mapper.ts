import {
  commitSchema,
  fileContentSchema,
  type Commit,
  type FileContent
} from "@engineering-os/source-control-domain";

import { GitHubPluginError } from "../client/github-errors.js";
import {
  githubCommitPayloadSchema,
  githubFileContentPayloadSchema,
  type GitHubCommitPayload,
  type GitHubFileContentPayload
} from "../github-api/payloads.js";
import { mapGitHubPayload, mappingHelpers } from "./mapping.js";

const hasNullByte = (bytes: Uint8Array): boolean => bytes.includes(0);

const decodeUtf8 = (bytes: Uint8Array): string | null => {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return hasNullByte(bytes) ? null : decoded;
  } catch {
    return null;
  }
};

export const mapFileContent = (payload: unknown): FileContent =>
  mapGitHubPayload("file content", () => {
    const content = githubFileContentPayloadSchema.parse(payload);

    if (content.type !== "file") {
      throw new GitHubPluginError({
        code: "VALIDATION_ERROR",
        message: "GitHub content path did not resolve to a file.",
        retryable: false
      });
    }

    return fileContentSchema.parse(toFileContent(content));
  });

const toFileContent = (payload: GitHubFileContentPayload): FileContent => {
  if (payload.encoding !== "base64" || payload.content === undefined) {
    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: "GitHub file content payload is missing base64 content.",
      retryable: false
    });
  }

  const encoded = payload.content.replace(/\s/g, "");
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  const decoded = decodeUtf8(bytes);

  if (decoded === null) {
    return {
      path: payload.path,
      sha: payload.sha,
      size: payload.size,
      encoding: "base64",
      content: encoded,
      binary: true
    };
  }

  return {
    path: payload.path,
    sha: payload.sha,
    size: payload.size,
    encoding: "utf-8",
    content: decoded,
    binary: false
  };
};

export const mapCommit = (payload: unknown): Commit =>
  mapGitHubPayload("commit", () => {
    const commit = githubCommitPayloadSchema.parse(payload);
    return commitSchema.parse(toCommit(commit));
  });

const toCommit = (payload: GitHubCommitPayload): Commit => ({
  provider: "github",
  sha: payload.sha,
  message: mappingHelpers.truncate(payload.commit.message, 10_000),
  author: {
    name: payload.commit.author.name,
    ...(payload.commit.author.email
      ? { email: payload.commit.author.email }
      : {}),
    date: mappingHelpers.normalizeIsoTimestamp(payload.commit.author.date)
  },
  url: payload.html_url,
  parentShas: (payload.parents ?? []).map((parent) => parent.sha)
});
