export {
  createGitHubCredentialResolver,
  type GitHubCredentialResolver
} from "./auth/credential-resolver.js";
export {
  githubAuthMethodSchema,
  githubMcpSecretEnvKey,
  githubMcpWorkspaceIdEnvKey,
  githubPatSecretKey,
  type GitHubAuthMethod,
  type GitHubResolvedAuth
} from "./auth/github-auth.js";
export { createGitHubClient } from "./client/github-client.js";
export type { GitHubClientDependencies } from "./client/github-client.js";
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
  GetPullRequestCommentsInput,
  GetPullRequestFilesInput,
  GetPullRequestInput,
  GitHubAuthenticatedAccount,
  GitHubClient,
  ListPullRequestsInput,
  ListRepositoriesInput
} from "./client/github-client.types.js";
export { githubMcpTools } from "./tools/catalog.js";
export { executeGitHubTool } from "./tools/execute-tool.js";
export {
  createGitHubMcpRequestHandler,
  listGitHubMcpToolDescriptors
} from "./mcp/handler.js";
export type { GitHubToolExecutionContext } from "./tools/tool.js";
export {
  GitHubPluginError,
  githubErrorCodes,
  isGitHubPluginError,
  redactSecrets,
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
