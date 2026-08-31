import {
  pullRequestCommentSchema,
  type PullRequestComment
} from "@engineering-os/source-control-domain";

import { GitHubPluginError } from "../client/github-errors.js";
import {
  githubCommentPayloadSchema,
  type GitHubCommentPayload
} from "../github-api/payloads.js";
import { mapGitHubPayload, mappingHelpers } from "./mapping.js";

export const mapPullRequestComment = (
  payload: unknown,
  pullRequestNumber: number
): PullRequestComment =>
  mapGitHubPayload("pull request comment", () => {
    const comment = githubCommentPayloadSchema.parse(payload);
    return pullRequestCommentSchema.parse(
      toPullRequestComment(comment, pullRequestNumber)
    );
  });

const toPullRequestComment = (
  payload: GitHubCommentPayload,
  pullRequestNumber: number
): PullRequestComment => {
  if (!payload.user) {
    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: "GitHub comment payload is missing an author.",
      retryable: false
    });
  }

  const filePath = payload.path;
  const line = payload.line ?? undefined;
  const commitSha = payload.commit_id;

  return {
    id: String(payload.id),
    kind: filePath ? "inline" : "conversation",
    pullRequestNumber,
    author: {
      id: String(payload.user.id),
      username: payload.user.login,
      ...(payload.user.avatar_url ? { avatarUrl: payload.user.avatar_url } : {})
    },
    body: mappingHelpers.truncate(payload.body, 65_536),
    createdAt: mappingHelpers.normalizeIsoTimestamp(payload.created_at),
    updatedAt: mappingHelpers.normalizeIsoTimestamp(payload.updated_at),
    url: payload.html_url,
    ...(filePath ? { filePath } : {}),
    ...(line === undefined ? {} : { line }),
    ...(commitSha ? { commitSha } : {})
  };
};
