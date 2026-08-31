import {
  pullRequestSchema,
  type PullRequest,
  type PullRequestState
} from "@engineering-os/source-control-domain";

import {
  githubPullRequestPayloadSchema,
  type GitHubPullRequestPayload
} from "../github-api/payloads.js";
import { GitHubPluginError } from "../client/github-errors.js";
import { mapGitHubPayload, mappingHelpers } from "./mapping.js";

export const mapPullRequest = (
  payload: unknown,
  repository: { owner: string; name: string }
): PullRequest =>
  mapGitHubPayload("pull request", () => {
    const pullRequest = githubPullRequestPayloadSchema.parse(payload);
    return pullRequestSchema.parse(toPullRequest(pullRequest, repository));
  });

const toPullRequestState = (
  payload: GitHubPullRequestPayload
): PullRequestState => {
  if (payload.merged_at) {
    return "merged";
  }

  return payload.state;
};

const toPullRequest = (
  payload: GitHubPullRequestPayload,
  repository: { owner: string; name: string }
): PullRequest => {
  if (!payload.user) {
    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: "GitHub pull request payload is missing an author.",
      retryable: false
    });
  }

  return {
    provider: "github",
    repository: {
      owner: repository.owner,
      name: repository.name
    },
    number: payload.number,
    title: mappingHelpers.truncate(payload.title, 512),
    description:
      payload.body === undefined || payload.body === null
        ? null
        : mappingHelpers.truncate(payload.body, 65_536),
    state: toPullRequestState(payload),
    author: {
      id: String(payload.user.id),
      username: payload.user.login,
      ...(payload.user.avatar_url ? { avatarUrl: payload.user.avatar_url } : {})
    },
    base: {
      ref: payload.base.ref,
      sha: payload.base.sha
    },
    head: {
      ref: payload.head.ref,
      sha: payload.head.sha
    },
    additions: payload.additions ?? 0,
    deletions: payload.deletions ?? 0,
    changedFiles: payload.changed_files ?? 0,
    createdAt: mappingHelpers.normalizeIsoTimestamp(payload.created_at),
    updatedAt: mappingHelpers.normalizeIsoTimestamp(payload.updated_at),
    url: payload.html_url
  };
};
