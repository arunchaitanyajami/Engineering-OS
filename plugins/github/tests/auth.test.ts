import { describe, expect, it } from "vitest";

import { createGitHubCredentialResolver } from "../src/auth/credential-resolver.js";
import { githubPatSecretKey } from "../src/auth/github-auth.js";
import { GitHubPluginError } from "../src/client/github-errors.js";
import { createMemorySecrets, testToken } from "./helpers.js";

describe("GitHub credential resolver", () => {
  it("resolves a personal access token from a secret reference", async () => {
    const resolver = createGitHubCredentialResolver(
      createMemorySecrets({ "connection-1.pat": testToken })
    );

    const resolved = await resolver.resolve({
      type: "personal-access-token",
      tokenRef: "connection-1.pat"
    });

    expect(resolved).toEqual({ type: "token", token: testToken });
  });

  it("resolves a stored OAuth access token using the same secret abstraction", async () => {
    const resolver = createGitHubCredentialResolver(
      createMemorySecrets({ "connection-1.oauth": testToken })
    );

    const resolved = await resolver.resolve({
      type: "oauth",
      accessTokenRef: "connection-1.oauth"
    });

    expect(resolved.token).toBe(testToken);
  });

  it("does not implement GitHub App installation tokens yet", async () => {
    const resolver = createGitHubCredentialResolver(createMemorySecrets({}));

    await expect(
      resolver.resolve({
        type: "github-app",
        installationId: "123",
        credentialRef: "connection-1.app"
      })
    ).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED"
    });
  });

  it("fails closed when the secret reference is missing", async () => {
    const resolver = createGitHubCredentialResolver(createMemorySecrets({}));

    await expect(
      resolver.resolve({
        type: "personal-access-token",
        tokenRef: "missing.pat"
      })
    ).rejects.toBeInstanceOf(GitHubPluginError);
  });

  it("does not put the resolved token in error messages", async () => {
    const resolver = createGitHubCredentialResolver(
      createMemorySecrets({ "connection-1.pat": "short" })
    );

    await expect(
      resolver.resolve({
        type: "personal-access-token",
        tokenRef: "connection-1.pat"
      })
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(GitHubPluginError);
      expect((error as GitHubPluginError).message).not.toContain("short");
      return true;
    });
  });

  it("scopes personal access token secret keys to a workspace and connection", () => {
    expect(
      githubPatSecretKey({
        workspaceId: "workspace-a",
        connectionId: "connection-1"
      })
    ).toBe("workspace.workspace-a.connection.connection-1.pat");
  });
});
