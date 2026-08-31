import type { GitHubClient } from "../client/github-client.types.js";
import type { GitHubToolExecutionContext } from "./tool.js";

export const createToolGitHubClient = (
  context: GitHubToolExecutionContext,
  connectionId: string
): Promise<GitHubClient> =>
  context.githubClientFactory.create({
    workspaceId: context.workspaceId,
    connectionId,
    ...(context.signal ? { signal: context.signal } : {})
  });
