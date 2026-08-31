import type { PluginSecretsApi } from "@engineering-os/plugin-sdk";

import { GitHubPluginError } from "../client/github-errors.js";
import {
  githubAuthMethodSchema,
  secretKeyForAuthMethod,
  type GitHubAuthMethod,
  type GitHubResolvedAuth
} from "./github-auth.js";

export interface GitHubCredentialResolver {
  resolve(method: GitHubAuthMethod): Promise<GitHubResolvedAuth>;
}

const assertTokenLooksLikeCredential = (token: string) => {
  const trimmed = token.trim();

  if (trimmed.length < 8) {
    throw new GitHubPluginError({
      code: "AUTHENTICATION_FAILED",
      message: "GitHub credential is missing or malformed.",
      retryable: false
    });
  }

  return trimmed;
};

export const createGitHubCredentialResolver = (
  secrets: Pick<PluginSecretsApi, "get">
): GitHubCredentialResolver => ({
  async resolve(method) {
    const parsedMethod = githubAuthMethodSchema.safeParse(method);

    if (!parsedMethod.success) {
      throw new GitHubPluginError({
        code: "VALIDATION_ERROR",
        message: "GitHub authentication method is invalid.",
        retryable: false
      });
    }

    const authMethod = parsedMethod.data;

    if (authMethod.type === "github-app") {
      throw new GitHubPluginError({
        code: "AUTHENTICATION_FAILED",
        message: "GitHub App authentication is not available yet.",
        retryable: false
      });
    }

    const secretKey = secretKeyForAuthMethod(authMethod);
    const token = await secrets.get(secretKey);

    if (token === null) {
      throw new GitHubPluginError({
        code: "AUTHENTICATION_FAILED",
        message: "GitHub credential reference could not be resolved.",
        retryable: false
      });
    }

    return {
      type: "token",
      token: assertTokenLooksLikeCredential(token)
    };
  }
});
