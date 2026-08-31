import type { PluginSecretsApi } from "@engineering-os/plugin-sdk";

import { createGitHubCredentialResolver } from "../auth/credential-resolver.js";
import type { GitHubAuthMethod } from "../auth/github-auth.js";
import { githubPluginId } from "../permissions/github-permissions.js";
import {
  createGitHubClient,
  type GitHubClientDependencies
} from "./github-client.js";
import type { GitHubClient } from "./github-client.types.js";
import { GitHubPluginError } from "./github-errors.js";

export interface GitHubConnectionSnapshot {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly pluginId: string;
  readonly authMethod: GitHubAuthMethod;
  readonly status: "connected" | "disconnected" | "expired" | "error";
}

export interface GitHubConnectionStore {
  get(input: {
    workspaceId: string;
    connectionId: string;
  }): Promise<GitHubConnectionSnapshot | null>;
}

export interface CreateGitHubClientInput {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly signal?: AbortSignal;
}

export interface GitHubClientFactory {
  create(input: CreateGitHubClientInput): Promise<GitHubClient>;
}

export const createGitHubClientFactory = (options: {
  connections: GitHubConnectionStore;
  secrets: Pick<PluginSecretsApi, "get">;
  dependencies?: GitHubClientDependencies;
}): GitHubClientFactory => ({
  async create(input) {
    const snapshot = await options.connections.get({
      workspaceId: input.workspaceId,
      connectionId: input.connectionId
    });

    if (!snapshot) {
      throw new GitHubPluginError({
        code: "VALIDATION_ERROR",
        message: "GitHub connection was not found in the active workspace.",
        retryable: false
      });
    }

    if (
      snapshot.workspaceId !== input.workspaceId ||
      snapshot.connectionId !== input.connectionId ||
      snapshot.pluginId !== githubPluginId
    ) {
      throw new GitHubPluginError({
        code: "PERMISSION_DENIED",
        message: "GitHub connection does not belong to the active workspace.",
        retryable: false
      });
    }

    if (snapshot.status !== "connected") {
      throw new GitHubPluginError({
        code: "AUTHENTICATION_FAILED",
        message: "GitHub connection is not connected.",
        retryable: false
      });
    }

    const auth = await createGitHubCredentialResolver(options.secrets).resolve(
      snapshot.authMethod
    );

    return createGitHubClient({
      token: auth.token,
      ...(options.dependencies ? { dependencies: options.dependencies } : {}),
      ...(input.signal ? { signal: input.signal } : {})
    });
  }
});
