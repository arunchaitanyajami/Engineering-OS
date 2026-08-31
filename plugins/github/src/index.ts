export {
  createGitHubCredentialResolver,
  type GitHubCredentialResolver
} from "./auth/credential-resolver.js";
export {
  githubAuthMethodSchema,
  type GitHubAuthMethod,
  type GitHubResolvedAuth
} from "./auth/github-auth.js";
export { createGitHubClient } from "./client/github-client.js";
export {
  createGitHubClientFactory,
  type CreateGitHubClientInput,
  type GitHubClientFactory,
  type GitHubConnectionSnapshot,
  type GitHubConnectionStore
} from "./client/github-client-factory.js";
export type {
  GetCommitInput,
  GetFileContentInput,
  GetPullRequestFilesInput,
  GetPullRequestInput,
  GitHubClient,
  ListPullRequestsInput,
  ListRepositoriesInput
} from "./client/github-client.types.js";
export {
  GitHubPluginError,
  githubErrorCodes,
  isGitHubPluginError,
  type GitHubErrorCode
} from "./client/github-errors.js";
export type { GitHubRateLimit } from "./client/rate-limit.js";
export { githubPluginManifest } from "./manifest.js";
export { githubPlugin } from "./plugin.js";
export {
  githubApiHost,
  githubPluginCapabilities,
  githubPluginId,
  type GitHubPluginCapability
} from "./permissions/github-permissions.js";

export { default } from "./plugin.js";
