import { describe, expect, it } from "vitest";

import { createGitHubClient } from "../src/client/github-client.js";
import { createGitHubClientFactory } from "../src/client/github-client-factory.js";
import { GitHubPluginError } from "../src/client/github-errors.js";
import { githubPluginId } from "../src/permissions/github-permissions.js";
import {
  createFetchMock,
  createMemorySecrets,
  gitSha,
  githubChangedFilePayload,
  githubCommitPayload,
  githubFileContentPayload,
  githubPullRequestPayload,
  githubRepositoryPayload,
  headSha,
  jsonResponse,
  testToken
} from "./helpers.js";

const createClient = (fetchMock: typeof fetch, signal?: AbortSignal) =>
  createGitHubClient({
    token: testToken,
    dependencies: {
      fetch: fetchMock,
      sleep: async () => undefined,
      maxRetryWaitMs: 5_000
    },
    ...(signal ? { signal } : {})
  });

describe("GitHub client adapter", () => {
  it("lists repositories through the normalized domain contract", async () => {
    const { fetchMock, calls } = createFetchMock((url) => {
      expect(url.pathname).toBe("/user/repos");
      return jsonResponse([githubRepositoryPayload]);
    });

    const repositories = await createClient(fetchMock).listRepositories({
      visibility: "private"
    });

    expect(repositories).toHaveLength(1);
    expect(repositories[0]?.fullName).toBe("acme/payments");
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: `Bearer ${testToken}`
    });
  });

  it("paginates list endpoints until GitHub omits a next link", async () => {
    const { fetchMock, calls } = createFetchMock((url) => {
      if (!url.searchParams.get("page")) {
        return jsonResponse([githubRepositoryPayload], {
          headers: {
            link: '<https://api.github.com/user/repos?page=2>; rel="next"'
          }
        });
      }

      return jsonResponse([
        {
          ...githubRepositoryPayload,
          name: "ledger",
          full_name: "acme/ledger",
          html_url: "https://github.com/acme/ledger"
        }
      ]);
    });

    const repositories = await createClient(fetchMock).listRepositories();

    expect(repositories.map((repository) => repository.name)).toEqual([
      "payments",
      "ledger"
    ]);
    expect(calls).toHaveLength(2);
  });

  it("maps a pull request, changed files, file content, and commit", async () => {
    const { fetchMock } = createFetchMock((url) => {
      if (url.pathname.endsWith("/pulls/123/files")) {
        return jsonResponse([githubChangedFilePayload]);
      }

      if (url.pathname.endsWith("/pulls/123")) {
        return jsonResponse(githubPullRequestPayload);
      }

      if (url.pathname.endsWith("/contents/src/index.ts")) {
        return jsonResponse(githubFileContentPayload);
      }

      if (url.pathname.endsWith(`/commits/${gitSha}`)) {
        return jsonResponse(githubCommitPayload);
      }

      return jsonResponse({ message: "unexpected" }, { status: 500 });
    });

    const client = createClient(fetchMock);
    const pullRequest = await client.getPullRequest({
      owner: "acme",
      repository: "payments",
      number: 123
    });
    const files = await client.getPullRequestFiles({
      owner: "acme",
      repository: "payments",
      number: 123
    });
    const content = await client.getFileContent({
      owner: "acme",
      repository: "payments",
      path: "src/index.ts",
      ref: headSha
    });
    const commit = await client.getCommit({
      owner: "acme",
      repository: "payments",
      ref: gitSha
    });

    expect(pullRequest.number).toBe(123);
    expect(files[0]?.path).toBe("src/checkout/totals.ts");
    expect(content.content).toBe("export {};\n");
    expect(commit.sha).toBe(gitSha);
  });

  it("maps 401, 404, and permission errors to typed plugin errors", async () => {
    const unauthorized = createClient(
      createFetchMock(() =>
        jsonResponse({ message: "Bad credentials" }, { status: 401 })
      ).fetchMock
    );
    const missingRepo = createClient(
      createFetchMock(() =>
        jsonResponse({ message: "Not Found" }, { status: 404 })
      ).fetchMock
    );
    const forbidden = createClient(
      createFetchMock(() =>
        jsonResponse(
          { message: "Resource not accessible by personal access token" },
          {
            status: 403,
            headers: { "x-ratelimit-remaining": "10" }
          }
        )
      ).fetchMock
    );

    await expect(unauthorized.listRepositories()).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
      retryable: false
    });
    await expect(
      missingRepo.listPullRequests({ owner: "acme", repository: "missing" })
    ).rejects.toMatchObject({ code: "REPOSITORY_NOT_FOUND" });
    await expect(
      forbidden.getPullRequest({
        owner: "acme",
        repository: "payments",
        number: 1
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("captures rate-limit metadata and retries a bounded number of times", async () => {
    let attempts = 0;
    const resetAt = Math.floor(Date.now() / 1000) + 1;
    const { fetchMock } = createFetchMock(() => {
      attempts += 1;

      if (attempts < 3) {
        return jsonResponse(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: {
              "x-ratelimit-limit": "60",
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(resetAt),
              "retry-after": "1"
            }
          }
        );
      }

      return jsonResponse([githubRepositoryPayload], {
        headers: {
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "12",
          "x-ratelimit-reset": String(resetAt)
        }
      });
    });

    const client = createClient(fetchMock);
    const repositories = await client.listRepositories();

    expect(repositories).toHaveLength(1);
    expect(attempts).toBe(3);
    expect(client.getRateLimit()).toMatchObject({
      limit: 60,
      remaining: 12
    });
  });

  it("throws RATE_LIMITED when the reset wait exceeds the bound", async () => {
    const { fetchMock } = createFetchMock(() =>
      jsonResponse(
        { message: "API rate limit exceeded" },
        {
          status: 429,
          headers: {
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
            "retry-after": "3600"
          }
        }
      )
    );

    await expect(
      createClient(fetchMock).listRepositories()
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true
    });
  });

  it("maps network failures and does not include the token in the error", async () => {
    const { fetchMock } = createFetchMock(() => {
      throw new TypeError(`fetch failed for Bearer ${testToken}`);
    });

    await expect(createClient(fetchMock).listRepositories()).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(GitHubPluginError);
        expect((error as GitHubPluginError).code).toBe("NETWORK_ERROR");
        expect((error as GitHubPluginError).message).not.toContain(testToken);
        return true;
      }
    );
  });

  it("honors cancellation before a GitHub request is sent", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createClient(
        createFetchMock(() => jsonResponse([])).fetchMock,
        controller.signal
      ).listRepositories()
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects path traversal in file content requests", async () => {
    await expect(
      createClient(
        createFetchMock(() => jsonResponse({})).fetchMock
      ).getFileContent({
        owner: "acme",
        repository: "payments",
        path: "../secrets.txt"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("does not expose the token on the client object", () => {
    const client = createClient(
      createFetchMock(() => jsonResponse([])).fetchMock
    );

    expect(JSON.stringify(client)).not.toContain(testToken);
    expect(client).not.toHaveProperty("token");
  });
});

describe("GitHub client factory", () => {
  it("creates a workspace-scoped client from a connection and secret reference", async () => {
    const { fetchMock } = createFetchMock(() =>
      jsonResponse([githubRepositoryPayload])
    );
    const factory = createGitHubClientFactory({
      connections: {
        async get() {
          return {
            workspaceId: "workspace-a",
            connectionId: "connection-1",
            pluginId: githubPluginId,
            status: "connected",
            authMethod: {
              type: "personal-access-token",
              tokenRef: "connection-1.pat"
            }
          };
        }
      },
      secrets: createMemorySecrets({ "connection-1.pat": testToken }),
      dependencies: { fetch: fetchMock, sleep: async () => undefined }
    });

    const client = await factory.create({
      workspaceId: "workspace-a",
      connectionId: "connection-1"
    });

    expect(await client.listRepositories()).toHaveLength(1);
  });

  it("denies a connection that belongs to another workspace", async () => {
    const factory = createGitHubClientFactory({
      connections: {
        async get() {
          return {
            workspaceId: "workspace-b",
            connectionId: "connection-1",
            pluginId: githubPluginId,
            status: "connected",
            authMethod: {
              type: "personal-access-token",
              tokenRef: "connection-1.pat"
            }
          };
        }
      },
      secrets: createMemorySecrets({ "connection-1.pat": testToken })
    });

    await expect(
      factory.create({
        workspaceId: "workspace-a",
        connectionId: "connection-1"
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
