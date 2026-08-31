import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolDescriptor } from "@engineering-os/contracts/unstable-runtime";
import { githubPluginId } from "@engineering-os/github-plugin";
import type { InstalledPlugin } from "@engineering-os/plugin-registry";
import type {
  ChangedFile,
  PullRequest,
  Repository
} from "@engineering-os/source-control-domain";

import { GitHubBrowseService } from "../src/github-browse-service.js";
import type { GitHubConnectionRecord } from "../src/github-connection-service.js";
import { PluginConnectionError } from "../src/plugin-connection-error.js";

const gitSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const companyConnection: GitHubConnectionRecord = {
  id: "connection-1",
  workspaceId: "workspace-a",
  pluginId: githubPluginId,
  displayName: "Company A GitHub",
  credentialRef: "workspace.workspace-a.connection.connection-1.pat",
  status: "connected",
  createdAt: "2026-08-31T08:00:00.000Z",
  updatedAt: "2026-08-31T08:00:00.000Z",
  accountLogin: "ada",
  lastError: null,
  authMethodType: "personal-access-token"
};

const personalConnection: GitHubConnectionRecord = {
  ...companyConnection,
  id: "connection-2",
  workspaceId: "workspace-b",
  displayName: "Personal GitHub",
  credentialRef: "workspace.workspace-b.connection.connection-2.pat"
};

const sampleRepository: Repository = {
  provider: "github",
  owner: "acme",
  name: "widgets",
  fullName: "acme/widgets",
  defaultBranch: "main",
  private: true,
  url: "https://github.com/acme/widgets",
  description: "Internal widgets"
};

const samplePullRequest: PullRequest = {
  provider: "github",
  repository: {
    owner: "acme",
    name: "widgets"
  },
  number: 12,
  title: "Harden authentication",
  description: "Reject expired tokens.",
  state: "open",
  author: {
    id: "42",
    username: "ada"
  },
  base: {
    ref: "main",
    sha: gitSha
  },
  head: {
    ref: "fix-auth",
    sha: otherSha
  },
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  createdAt: "2026-08-31T08:00:00.000Z",
  updatedAt: "2026-08-31T09:00:00.000Z",
  url: "https://github.com/acme/widgets/pull/12"
};

const sampleChangedFile: ChangedFile = {
  path: "src/auth.ts",
  status: "modified",
  additions: 1,
  deletions: 0,
  binary: false,
  language: "TypeScript",
  patch:
    "@@ -1,2 +1,3 @@\n export const ok = true;\n+export const tax = 1;\n export const ready = true;\n"
};

const listRepositoriesTool: ToolDescriptor = {
  id: "com.engineering-os.github.github.tool.github.list_repositories",
  serverId: "github",
  pluginId: githubPluginId,
  name: "github.list_repositories",
  inputSchema: {
    type: "object",
    properties: {
      connectionId: { type: "string" }
    },
    required: ["connectionId"],
    additionalProperties: false
  },
  riskLevel: "read-only"
};

const listPullRequestsTool: ToolDescriptor = {
  ...listRepositoriesTool,
  id: "com.engineering-os.github.github.tool.github.list_pull_requests",
  name: "github.list_pull_requests"
};

const getPullRequestTool: ToolDescriptor = {
  ...listRepositoriesTool,
  id: "com.engineering-os.github.github.tool.github.get_pull_request",
  name: "github.get_pull_request"
};

const getPullRequestFilesTool: ToolDescriptor = {
  ...listRepositoriesTool,
  id: "com.engineering-os.github.github.tool.github.get_pull_request_files",
  name: "github.get_pull_request_files"
};

const enabledPlugin = {
  pluginId: githubPluginId,
  enabled: true
} as InstalledPlugin;

describe("GitHub browse service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createService = (options?: {
    readonly connections?: GitHubConnectionRecord[];
    readonly pluginEnabled?: boolean;
    readonly pluginInstalled?: boolean;
  }) => {
    const connections = options?.connections ?? [companyConnection];
    const executeTool = vi.fn(async (request: { readonly toolId: string }) => {
      if (request.toolId === listRepositoriesTool.id) {
        return {
          status: "success" as const,
          content: [],
          metadata: { structuredContent: [sampleRepository] }
        };
      }

      if (request.toolId === listPullRequestsTool.id) {
        return {
          status: "success" as const,
          content: [],
          metadata: { structuredContent: [samplePullRequest] }
        };
      }

      if (request.toolId === getPullRequestFilesTool.id) {
        return {
          status: "success" as const,
          content: [],
          metadata: { structuredContent: [sampleChangedFile] }
        };
      }

      return {
        status: "success" as const,
        content: [],
        metadata: { structuredContent: samplePullRequest }
      };
    });
    let serverRunning = false;
    const startServer = vi.fn(async () => {
      serverRunning = true;
      return { healthState: "healthy" as const };
    });
    const stopServer = vi.fn(async () => {
      serverRunning = false;
      return { healthState: "unknown" as const };
    });
    const setTransportEnvironmentOverlay = vi.fn();
    const inspectServerHealth = vi.fn(() => ({
      healthState: serverRunning ? ("healthy" as const) : ("unknown" as const)
    }));

    const service = new GitHubBrowseService({
      connections: {
        getConnection: (request) => {
          const connection = connections.find(
            (candidate) =>
              candidate.id === request.connectionId &&
              candidate.workspaceId === request.workspaceId
          );

          if (!connection) {
            throw new PluginConnectionError(
              "GITHUB_CONNECTION_NOT_FOUND",
              "GitHub connection was not found in the active workspace.",
              404
            );
          }

          return connection;
        }
      },
      pluginRegistry: {
        getInstalledPlugin: (pluginId) =>
          pluginId === githubPluginId && options?.pluginInstalled !== false
            ? options?.pluginEnabled === false
              ? ({ pluginId, enabled: false } as InstalledPlugin)
              : enabledPlugin
            : null
      },
      mcpGateway: {
        setTransportEnvironmentOverlay,
        inspectServerHealth: inspectServerHealth as never,
        startServer: startServer as never,
        stopServer: stopServer as never,
        listTools: () => [
          listRepositoriesTool,
          listPullRequestsTool,
          getPullRequestTool,
          getPullRequestFilesTool
        ],
        executeTool: executeTool as never
      },
      permissionEngine: {
        evaluateToolExecution: () => ({
          allowed: true,
          requiredApproval: "none"
        })
      },
      createCorrelationId: () => "corr-browse"
    });

    return {
      executeTool,
      inspectServerHealth,
      service,
      setTransportEnvironmentOverlay,
      startServer,
      stopServer
    };
  };

  it("lists repositories through MCP tools for the owning workspace connection", async () => {
    const {
      executeTool,
      service,
      setTransportEnvironmentOverlay,
      startServer
    } = createService();

    await expect(
      service.listRepositories({
        workspaceId: "workspace-a",
        connectionId: "connection-1"
      })
    ).resolves.toEqual([sampleRepository]);

    expect(startServer).toHaveBeenCalledWith(
      "com.engineering-os.github:github"
    );
    expect(setTransportEnvironmentOverlay).toHaveBeenCalledWith(
      "com.engineering-os.github:github",
      expect.objectContaining({
        ENGINEERING_OS_WORKSPACE_ID: "workspace-a",
        ENGINEERING_OS_SECRET_WORKSPACE_WORKSPACE_A_CONNECTION_CONNECTION_1_PAT:
          { key: companyConnection.credentialRef }
      })
    );
    expect(executeTool).toHaveBeenCalledWith({
      toolId: listRepositoriesTool.id,
      arguments: { connectionId: "connection-1" },
      executionContext: {
        actor: { type: "user", id: "desktop-github-browser" },
        correlationId: "corr-browse",
        approvalMode: "none"
      }
    });
    expect(JSON.stringify(executeTool.mock.calls)).not.toContain("ghp_");
  });

  it("keeps two workspaces isolated when browsing pull requests", async () => {
    const { executeTool, service } = createService({
      connections: [companyConnection, personalConnection]
    });

    await expect(
      service.listPullRequests({
        workspaceId: "workspace-b",
        connectionId: "connection-1",
        owner: "acme",
        repository: "widgets"
      })
    ).rejects.toMatchObject({
      code: "GITHUB_CONNECTION_NOT_FOUND"
    });

    await expect(
      service.listPullRequests({
        workspaceId: "workspace-b",
        connectionId: "connection-2",
        owner: "acme",
        repository: "widgets"
      })
    ).resolves.toEqual([samplePullRequest]);

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0]?.[0]).toMatchObject({
      arguments: {
        connectionId: "connection-2",
        owner: "acme",
        repository: "widgets"
      }
    });
  });

  it("loads selected pull request metadata through MCP only", async () => {
    const { executeTool, service } = createService();

    await expect(
      service.getPullRequest({
        workspaceId: "workspace-a",
        connectionId: "connection-1",
        owner: "acme",
        repository: "widgets",
        pullRequestNumber: 12
      })
    ).resolves.toEqual(samplePullRequest);

    expect(executeTool.mock.calls[0]?.[0]).toMatchObject({
      toolId: getPullRequestTool.id,
      arguments: {
        connectionId: "connection-1",
        owner: "acme",
        repository: "widgets",
        pullRequestNumber: 12
      }
    });
  });

  it("retrieves changed files through MCP and parses mapped diff lines", async () => {
    const { executeTool, service } = createService();
    const diffSet = await service.getPullRequestFiles({
      workspaceId: "workspace-a",
      connectionId: "connection-1",
      owner: "acme",
      repository: "widgets",
      pullRequestNumber: 12
    });

    expect(executeTool.mock.calls[0]?.[0]).toMatchObject({
      toolId: getPullRequestFilesTool.id,
      arguments: {
        connectionId: "connection-1",
        owner: "acme",
        repository: "widgets",
        pullRequestNumber: 12
      }
    });
    expect(diffSet.files[0]?.path).toBe("src/auth.ts");
    expect(diffSet.diffs[0]?.hunks[0]?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "addition",
          content: "export const tax = 1;",
          newLineNumber: 2
        })
      ])
    );
    expect(diffSet.decisions[0]?.decision).toEqual({ include: true });
  });

  it("does not retrieve files for another workspace connection", async () => {
    const { executeTool, service } = createService({
      connections: [companyConnection, personalConnection]
    });

    await expect(
      service.getPullRequestFiles({
        workspaceId: "workspace-b",
        connectionId: "connection-1",
        owner: "acme",
        repository: "widgets",
        pullRequestNumber: 12
      })
    ).rejects.toMatchObject({
      code: "GITHUB_CONNECTION_NOT_FOUND"
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("does not browse when the GitHub connection is disconnected", async () => {
    const { executeTool, service } = createService({
      connections: [{ ...companyConnection, status: "disconnected" }]
    });

    await expect(
      service.listRepositories({
        workspaceId: "workspace-a",
        connectionId: "connection-1"
      })
    ).rejects.toMatchObject({
      code: "GITHUB_CONNECTION_NOT_READY"
    });
    expect(executeTool).not.toHaveBeenCalled();
  });
});
