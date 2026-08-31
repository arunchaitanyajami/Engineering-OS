import { randomUUID } from "node:crypto";

import type {
  GatewayEnvironmentValue,
  McpServerHealthSnapshot,
  ToolDescriptor,
  ToolExecutionResult
} from "@engineering-os/contracts/unstable-runtime";
import {
  githubMcpSecretEnvKey,
  githubMcpWorkspaceIdEnvKey,
  githubPluginId
} from "@engineering-os/github-plugin";
import { McpGatewayError } from "@engineering-os/mcp-gateway";
import type { PermissionEngineService } from "@engineering-os/permission-engine";
import type { PluginRegistryService } from "@engineering-os/plugin-registry";
import {
  pullRequestSchema,
  repositorySchema,
  type PullRequest,
  type Repository
} from "@engineering-os/source-control-domain";
import { z } from "zod";

import {
  githubConnectionReferenceRequestSchema,
  type GitHubConnectionRecord,
  type GitHubConnectionService
} from "./github-connection-service.js";
import { PluginConnectionError } from "./plugin-connection-error.js";

export const githubMcpRegistrationId = `${githubPluginId}:github`;

export const listGitHubRepositoriesRequestSchema =
  githubConnectionReferenceRequestSchema;

export const listGitHubPullRequestsRequestSchema = z
  .object({
    workspaceId: z.string().trim().min(1).max(128),
    connectionId: z.string().trim().min(1).max(128),
    owner: z.string().trim().min(1).max(128),
    repository: z.string().trim().min(1).max(128),
    state: z.enum(["open", "closed", "all"]).optional()
  })
  .strict();

export const getGitHubPullRequestRequestSchema = z
  .object({
    workspaceId: z.string().trim().min(1).max(128),
    connectionId: z.string().trim().min(1).max(128),
    owner: z.string().trim().min(1).max(128),
    repository: z.string().trim().min(1).max(128),
    pullRequestNumber: z.coerce.number().int().positive()
  })
  .strict();

export type ListGitHubRepositoriesRequest = z.infer<
  typeof listGitHubRepositoriesRequestSchema
>;

export type ListGitHubPullRequestsRequest = z.infer<
  typeof listGitHubPullRequestsRequestSchema
>;

export type GetGitHubPullRequestRequest = z.infer<
  typeof getGitHubPullRequestRequestSchema
>;

export interface GitHubBrowseServiceOptions {
  readonly connections: Pick<GitHubConnectionService, "getConnection">;
  readonly pluginRegistry: Pick<PluginRegistryService, "getInstalledPlugin">;
  readonly mcpGateway: {
    setTransportEnvironmentOverlay(
      registrationId: string,
      environment: Readonly<Record<string, GatewayEnvironmentValue>>
    ): void;
    inspectServerHealth(registrationId: string): McpServerHealthSnapshot;
    startServer(registrationId: string): Promise<McpServerHealthSnapshot>;
    stopServer(registrationId: string): Promise<McpServerHealthSnapshot>;
    listTools(options?: {
      readonly pluginId?: string;
      readonly serverId?: string;
    }): readonly ToolDescriptor[];
    executeTool(
      request: {
        readonly toolId: string;
        readonly arguments: Record<string, unknown>;
        readonly executionContext: {
          readonly actor: { readonly type: "user"; readonly id?: string };
          readonly correlationId: string;
          readonly approvalMode: "none";
        };
      },
      options?: { readonly signal?: AbortSignal }
    ): Promise<ToolExecutionResult>;
  };
  readonly permissionEngine: Pick<
    PermissionEngineService,
    "evaluateToolExecution"
  >;
  readonly createCorrelationId?: () => string;
}

const githubBrowseTools = {
  listRepositories: "github.list_repositories",
  listPullRequests: "github.list_pull_requests",
  getPullRequest: "github.get_pull_request"
} as const;

const toPluginConnectionError = (error: unknown): PluginConnectionError => {
  if (error instanceof PluginConnectionError) {
    return error;
  }

  if (error instanceof McpGatewayError) {
    return new PluginConnectionError(
      error.code,
      error.message,
      error.statusCode,
      { cause: error }
    );
  }

  return new PluginConnectionError(
    "GITHUB_BROWSE_FAILED",
    "GitHub browse request failed.",
    500,
    { cause: error }
  );
};

const readTextContent = (result: ToolExecutionResult): string | null => {
  const textItem = result.content.find((item) => item.type === "text");

  return textItem && "text" in textItem && typeof textItem.text === "string"
    ? textItem.text
    : null;
};

const readStructuredContent = (result: ToolExecutionResult): unknown => {
  const metadata = result.metadata;

  if (
    metadata &&
    typeof metadata === "object" &&
    "structuredContent" in metadata
  ) {
    return metadata.structuredContent;
  }

  const text = readTextContent(result);

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

export class GitHubBrowseService {
  private mcpSessionKey: string | null = null;

  constructor(private readonly options: GitHubBrowseServiceOptions) {}

  listRepositories(
    request: ListGitHubRepositoriesRequest,
    signal?: AbortSignal
  ): Promise<readonly Repository[]> {
    const parsed = listGitHubRepositoriesRequestSchema.parse(request);

    return this.executeReadTool({
      request: parsed,
      toolName: githubBrowseTools.listRepositories,
      arguments: {
        connectionId: parsed.connectionId
      },
      outputSchema: z.array(repositorySchema),
      ...(signal ? { signal } : {})
    });
  }

  listPullRequests(
    request: ListGitHubPullRequestsRequest,
    signal?: AbortSignal
  ): Promise<readonly PullRequest[]> {
    const parsed = listGitHubPullRequestsRequestSchema.parse(request);

    return this.executeReadTool({
      request: parsed,
      toolName: githubBrowseTools.listPullRequests,
      arguments: {
        connectionId: parsed.connectionId,
        owner: parsed.owner,
        repository: parsed.repository,
        ...(parsed.state ? { state: parsed.state } : {})
      },
      outputSchema: z.array(pullRequestSchema),
      ...(signal ? { signal } : {})
    });
  }

  getPullRequest(
    request: GetGitHubPullRequestRequest,
    signal?: AbortSignal
  ): Promise<PullRequest> {
    const parsed = getGitHubPullRequestRequestSchema.parse(request);

    return this.executeReadTool({
      request: parsed,
      toolName: githubBrowseTools.getPullRequest,
      arguments: {
        connectionId: parsed.connectionId,
        owner: parsed.owner,
        repository: parsed.repository,
        pullRequestNumber: parsed.pullRequestNumber
      },
      outputSchema: pullRequestSchema,
      ...(signal ? { signal } : {})
    });
  }

  private async executeReadTool<T>(input: {
    readonly request: {
      readonly workspaceId: string;
      readonly connectionId: string;
    };
    readonly toolName: string;
    readonly arguments: Record<string, unknown>;
    readonly outputSchema: z.ZodType<T>;
    readonly signal?: AbortSignal;
  }): Promise<T> {
    try {
      const connection = this.requireConnectedConnection(input.request);
      await this.ensureGitHubMcpServer(connection);

      const tool = this.requireTool(input.toolName);
      const executionContext = {
        actor: { type: "user" as const, id: "desktop-github-browser" },
        correlationId: (this.options.createCorrelationId ?? randomUUID)(),
        approvalMode: "none" as const
      };
      const evaluation = this.options.permissionEngine.evaluateToolExecution({
        tool,
        executionContext
      });

      if (!evaluation.allowed) {
        throw new PluginConnectionError(
          evaluation.code ?? "GITHUB_BROWSE_DENIED",
          evaluation.message ??
            "GitHub browse is not permitted for this plugin.",
          evaluation.code === "MCP_TOOL_EXECUTION_APPROVAL_REQUIRED" ? 409 : 403
        );
      }

      const toolRequest = {
        toolId: tool.id,
        arguments: input.arguments,
        executionContext
      };
      const result = input.signal
        ? await this.options.mcpGateway.executeTool(toolRequest, {
            signal: input.signal
          })
        : await this.options.mcpGateway.executeTool(toolRequest);

      return input.outputSchema.parse(this.parseSuccessfulOutput(result));
    } catch (error) {
      throw toPluginConnectionError(error);
    }
  }

  private requireConnectedConnection(request: {
    readonly workspaceId: string;
    readonly connectionId: string;
  }): GitHubConnectionRecord {
    const plugin =
      this.options.pluginRegistry.getInstalledPlugin(githubPluginId);

    if (!plugin) {
      throw new PluginConnectionError(
        "GITHUB_PLUGIN_NOT_FOUND",
        "Install the GitHub plugin before browsing repositories.",
        409
      );
    }

    if (!plugin.enabled) {
      throw new PluginConnectionError(
        "GITHUB_PLUGIN_DISABLED",
        "Enable the GitHub plugin before browsing repositories.",
        409
      );
    }

    const connection = this.options.connections.getConnection(request);

    if (connection.status !== "connected") {
      throw new PluginConnectionError(
        "GITHUB_CONNECTION_NOT_READY",
        "Connect GitHub in this workspace before browsing repositories.",
        409
      );
    }

    return connection;
  }

  private async ensureGitHubMcpServer(
    connection: GitHubConnectionRecord
  ): Promise<void> {
    const overlay: Record<string, GatewayEnvironmentValue> = {
      [githubMcpWorkspaceIdEnvKey]: connection.workspaceId,
      [githubMcpSecretEnvKey(connection.credentialRef)]: {
        key: connection.credentialRef
      }
    };
    const sessionKey = JSON.stringify({
      workspaceId: connection.workspaceId,
      credentialRef: connection.credentialRef
    });
    const health = this.options.mcpGateway.inspectServerHealth(
      githubMcpRegistrationId
    );
    const isRunning = health.healthState === "healthy";

    if (isRunning && this.mcpSessionKey === sessionKey) {
      return;
    }

    if (isRunning) {
      await this.options.mcpGateway.stopServer(githubMcpRegistrationId);
    }

    this.options.mcpGateway.setTransportEnvironmentOverlay(
      githubMcpRegistrationId,
      overlay
    );
    await this.options.mcpGateway.startServer(githubMcpRegistrationId);
    this.mcpSessionKey = sessionKey;
  }

  private requireTool(toolName: string): ToolDescriptor {
    const tool = this.options.mcpGateway
      .listTools({
        pluginId: githubPluginId,
        serverId: "github"
      })
      .find((candidate) => candidate.name === toolName);

    if (!tool) {
      throw new PluginConnectionError(
        "GITHUB_MCP_TOOL_NOT_FOUND",
        `GitHub MCP tool '${toolName}' is not available. Start the GitHub MCP server from a connected workspace.`,
        409
      );
    }

    return tool;
  }

  private parseSuccessfulOutput(result: ToolExecutionResult): unknown {
    if (result.status === "success") {
      return readStructuredContent(result);
    }

    throw new PluginConnectionError(
      result.error?.code ?? "GITHUB_MCP_TOOL_FAILED",
      result.error?.message ?? "GitHub MCP tool failed.",
      result.status === "timeout" ? 504 : 502
    );
  }
}
