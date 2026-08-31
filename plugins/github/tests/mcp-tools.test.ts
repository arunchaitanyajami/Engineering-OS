import { describe, expect, it } from "vitest";

import { createGitHubClientFactory } from "../src/client/github-client-factory.js";
import type { GitHubConnectionSnapshot } from "../src/client/github-client-factory.js";
import { GitHubPluginError } from "../src/client/github-errors.js";
import { createGitHubMcpRequestHandler } from "../src/mcp/handler.js";
import {
  githubPluginCapabilities,
  githubPluginId
} from "../src/permissions/github-permissions.js";
import { githubMcpTools } from "../src/tools/catalog.js";
import { executeGitHubTool } from "../src/tools/execute-tool.js";
import type { GitHubToolExecutionContext } from "../src/tools/tool.js";
import {
  createFetchMock,
  createMemorySecrets,
  gitSha,
  githubChangedFilePayload,
  githubCommitPayload,
  githubConversationCommentPayload,
  githubFileContentPayload,
  githubInlineCommentPayload,
  githubPullRequestPayload,
  githubRepositoryPayload,
  jsonResponse,
  testToken
} from "./helpers.js";

const connectedSnapshot = (
  overrides: Partial<GitHubConnectionSnapshot> = {}
): GitHubConnectionSnapshot => ({
  workspaceId: "workspace-a",
  connectionId: "connection-1",
  pluginId: githubPluginId,
  status: "connected",
  authMethod: {
    type: "personal-access-token",
    tokenRef: "connection-1.pat"
  },
  ...overrides
});

const allReadCapabilities = new Set([
  githubPluginCapabilities.repositoriesRead,
  githubPluginCapabilities.contentsRead,
  githubPluginCapabilities.pullRequestsRead
]);

const createContext = (options: {
  snapshot?: GitHubConnectionSnapshot;
  workspaceId?: string;
  capabilities?: Set<
    (typeof githubPluginCapabilities)[keyof typeof githubPluginCapabilities]
  >;
  fetchMock?: typeof fetch;
  signal?: AbortSignal;
}): GitHubToolExecutionContext => {
  const snapshot = options.snapshot ?? connectedSnapshot();
  const { fetchMock } = createFetchMock((url) => {
    if (options.fetchMock) {
      return options.fetchMock(url);
    }

    if (url.pathname === "/user/repos") {
      return jsonResponse([githubRepositoryPayload]);
    }

    if (url.pathname.endsWith("/pulls/123/files")) {
      return jsonResponse([githubChangedFilePayload]);
    }

    if (url.pathname.endsWith("/pulls/123/comments")) {
      return jsonResponse([githubInlineCommentPayload]);
    }

    if (url.pathname.endsWith("/issues/123/comments")) {
      return jsonResponse([githubConversationCommentPayload]);
    }

    if (
      url.pathname.endsWith("/pulls/123") ||
      url.pathname.endsWith("/pulls")
    ) {
      return jsonResponse(
        url.pathname.endsWith("/pulls")
          ? [githubPullRequestPayload]
          : githubPullRequestPayload
      );
    }

    if (url.pathname.endsWith("/contents/src/index.ts")) {
      return jsonResponse(githubFileContentPayload);
    }

    if (url.pathname.includes("/commits/")) {
      return jsonResponse(githubCommitPayload);
    }

    return jsonResponse({ message: "Not Found" }, { status: 404 });
  });

  return {
    workspaceId: options.workspaceId ?? snapshot.workspaceId,
    grantedCapabilities: options.capabilities ?? allReadCapabilities,
    githubClientFactory: createGitHubClientFactory({
      connections: {
        async get() {
          return snapshot;
        }
      },
      secrets: createMemorySecrets({ "connection-1.pat": testToken }),
      dependencies: {
        fetch: options.fetchMock ?? fetchMock,
        sleep: async () => undefined
      }
    }),
    ...(options.signal ? { signal: options.signal } : {})
  };
};

describe("GitHub MCP tool catalog", () => {
  it("exposes the required read-only GitHub tools", () => {
    expect(githubMcpTools.map((tool) => tool.name)).toEqual([
      "github.list_repositories",
      "github.list_pull_requests",
      "github.get_pull_request",
      "github.get_pull_request_files",
      "github.get_file_content",
      "github.get_commit",
      "github.get_pull_request_comments"
    ]);
    expect(
      githubMcpTools.every(
        (tool) => tool.jsonInputSchema.additionalProperties === false
      )
    ).toBe(true);
  });
});

describe("github.get_pull_request", () => {
  it("rejects invalid PR numbers", async () => {
    await expect(
      executeGitHubTool(
        "github.get_pull_request",
        {
          connectionId: "connection-1",
          owner: "acme",
          repository: "payments",
          pullRequestNumber: 0
        },
        createContext({})
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects extra LLM-supplied fields", async () => {
    await expect(
      executeGitHubTool(
        "github.get_pull_request",
        {
          connectionId: "connection-1",
          owner: "acme",
          repository: "payments",
          pullRequestNumber: 123,
          workspaceId: "workspace-b"
        },
        createContext({})
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns a normalized pull request", async () => {
    const pullRequest = await executeGitHubTool(
      "github.get_pull_request",
      {
        connectionId: "connection-1",
        owner: "acme",
        repository: "payments",
        pullRequestNumber: 123
      },
      createContext({})
    );

    expect(pullRequest).toMatchObject({
      provider: "github",
      number: 123,
      repository: { owner: "acme", name: "payments" }
    });
    expect(pullRequest).not.toHaveProperty("node_id");
  });

  it("requires pullRequests.read", async () => {
    await expect(
      executeGitHubTool(
        "github.get_pull_request",
        {
          connectionId: "connection-1",
          owner: "acme",
          repository: "payments",
          pullRequestNumber: 123
        },
        createContext({
          capabilities: new Set([githubPluginCapabilities.repositoriesRead])
        })
      )
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: expect.stringContaining("pullRequests.read")
    });
  });

  it("rejects a connection from another workspace", async () => {
    await expect(
      executeGitHubTool(
        "github.get_pull_request",
        {
          connectionId: "connection-1",
          owner: "acme",
          repository: "payments",
          pullRequestNumber: 123
        },
        createContext({
          workspaceId: "workspace-a",
          snapshot: connectedSnapshot({ workspaceId: "workspace-b" })
        })
      )
    ).rejects.toBeInstanceOf(GitHubPluginError);
  });

  it("honors cancellation", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeGitHubTool(
        "github.get_pull_request",
        {
          connectionId: "connection-1",
          owner: "acme",
          repository: "payments",
          pullRequestNumber: 123
        },
        createContext({ signal: controller.signal })
      )
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("remaining GitHub MCP read tools", () => {
  it("lists repositories through repositories.read", async () => {
    const repositories = await executeGitHubTool(
      "github.list_repositories",
      { connectionId: "connection-1", visibility: "private" },
      createContext({})
    );

    expect(repositories).toEqual([
      expect.objectContaining({ fullName: "acme/payments", provider: "github" })
    ]);
  });

  it("lists pull requests for a repository", async () => {
    const pullRequests = await executeGitHubTool(
      "github.list_pull_requests",
      {
        connectionId: "connection-1",
        owner: "acme",
        repository: "payments",
        state: "open"
      },
      createContext({})
    );

    expect(pullRequests).toHaveLength(1);
  });

  it("returns changed files, file content, and the commit", async () => {
    const context = createContext({});
    const files = await executeGitHubTool(
      "github.get_pull_request_files",
      {
        connectionId: "connection-1",
        owner: "acme",
        repository: "payments",
        pullRequestNumber: 123
      },
      context
    );
    const content = await executeGitHubTool(
      "github.get_file_content",
      {
        connectionId: "connection-1",
        owner: "acme",
        repository: "payments",
        path: "src/index.ts",
        ref: gitSha
      },
      context
    );
    const commit = await executeGitHubTool(
      "github.get_commit",
      {
        connectionId: "connection-1",
        owner: "acme",
        repository: "payments",
        ref: gitSha
      },
      context
    );

    expect(files).toEqual([
      expect.objectContaining({ path: "src/checkout/totals.ts" })
    ]);
    expect(content).toEqual(
      expect.objectContaining({ encoding: "utf-8", binary: false })
    );
    expect(commit).toEqual(expect.objectContaining({ sha: gitSha }));
  });

  it("returns inline and conversation comments", async () => {
    const comments = await executeGitHubTool(
      "github.get_pull_request_comments",
      {
        connectionId: "connection-1",
        owner: "acme",
        repository: "payments",
        pullRequestNumber: 123
      },
      createContext({})
    );

    expect(comments).toEqual([
      expect.objectContaining({
        kind: "inline",
        filePath: "src/checkout/totals.ts",
        line: 48
      }),
      expect.objectContaining({
        kind: "conversation",
        author: expect.objectContaining({ username: "grace" })
      })
    ]);
  });

  it("does not allow contents.read tools without that capability", async () => {
    await expect(
      executeGitHubTool(
        "github.get_file_content",
        {
          connectionId: "connection-1",
          owner: "acme",
          repository: "payments",
          path: "src/index.ts"
        },
        createContext({
          capabilities: new Set([githubPluginCapabilities.pullRequestsRead])
        })
      )
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});

describe("GitHub MCP JSON-RPC handler", () => {
  it("lists tools with read-only annotations", async () => {
    const handler = createGitHubMcpRequestHandler(createContext({}));
    const response = await handler({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    });

    expect(response).toMatchObject({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "github.get_pull_request",
            annotations: expect.objectContaining({ readOnlyHint: true })
          })
        ])
      }
    });
  });

  it("returns structured tool output and typed errors", async () => {
    const handler = createGitHubMcpRequestHandler(createContext({}));
    const success = await handler({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "github.get_pull_request",
        arguments: {
          connectionId: "connection-1",
          owner: "acme",
          repository: "payments",
          pullRequestNumber: 123
        }
      }
    });

    expect(success).toMatchObject({
      result: {
        isError: false,
        structuredContent: expect.objectContaining({ number: 123 })
      }
    });

    const failure = await handler({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "github.get_pull_request",
        arguments: {
          connectionId: "connection-1",
          owner: "acme",
          repository: "payments",
          pullRequestNumber: -1
        }
      }
    });

    expect(failure).toMatchObject({
      result: {
        isError: true,
        content: [
          expect.objectContaining({
            text: expect.stringContaining("VALIDATION_ERROR")
          })
        ]
      }
    });
  });
});
