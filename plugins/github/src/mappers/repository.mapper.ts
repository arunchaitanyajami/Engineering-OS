import {
  repositorySchema,
  type Repository
} from "@engineering-os/source-control-domain";

import {
  githubRepositoryPayloadSchema,
  type GitHubRepositoryPayload
} from "../github-api/payloads.js";
import { mapGitHubPayload, mappingHelpers } from "./mapping.js";

export const mapRepository = (payload: unknown): Repository =>
  mapGitHubPayload("repository", () => {
    const repository = githubRepositoryPayloadSchema.parse(payload);
    return repositorySchema.parse(toRepository(repository));
  });

const toRepository = (payload: GitHubRepositoryPayload): Repository => {
  const description =
    payload.description === undefined
      ? undefined
      : payload.description === null || payload.description.trim().length === 0
        ? null
        : payload.description;

  return {
    provider: "github",
    owner: payload.owner.login,
    name: payload.name,
    fullName: mappingHelpers.truncate(payload.full_name, 257),
    defaultBranch: mappingHelpers.truncate(
      payload.default_branch ?? "main",
      255
    ),
    private: payload.private,
    url: payload.html_url,
    ...(description === undefined ? {} : { description })
  };
};
