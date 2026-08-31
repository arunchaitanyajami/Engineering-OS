import type { PluginManifest } from "@engineering-os/contracts";
import type { PersistedLogEntry } from "@engineering-os/platform";
import type {
  AuditEvent,
  GrantPluginPermissionsRequest,
  McpServerHealthSnapshot,
  McpServerRegistration,
  McpToolExecutionRecord,
  PluginPermissionReviewSnapshot,
  PluginRuntimeHealthSnapshot,
  PromptDescriptor,
  RegisteredMcpServer,
  ResourceDescriptor,
  RevokePluginPermissionRequest,
  ToolDescriptor,
  ToolExecutionRequest,
  ToolExecutionResult
} from "@engineering-os/contracts/unstable-runtime";

import { requestDesktopBackend } from "./desktop-backend-request.js";

export interface PluginInstallation {
  readonly mode: "managed" | "development-link";
  readonly rootPath: string;
  readonly contentHash: string;
  readonly source: {
    readonly type: "local-directory";
    readonly path: string;
  };
}

export interface InstalledPlugin {
  readonly id: string;
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  readonly installation: PluginInstallation;
  readonly state: "installed" | "incompatible" | "removed";
  readonly enabled: boolean;
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly lastError: string | null;
}

export type GitHubConnectionStatus =
  "connected" | "disconnected" | "expired" | "error";

export interface EngineeringWorkspace {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GitHubConnectionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly pluginId: string;
  readonly displayName: string;
  readonly credentialRef: string;
  readonly status: GitHubConnectionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly accountLogin: string | null;
  readonly lastError: string | null;
  readonly authMethodType: "oauth" | "personal-access-token" | "github-app";
}

export interface GitHubRepository {
  readonly provider: "github";
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly private: boolean;
  readonly url: string;
  readonly description?: string | null;
}

export interface GitHubPullRequestAuthor {
  readonly id: string;
  readonly username: string;
  readonly avatarUrl?: string;
}

export interface GitHubPullRequest {
  readonly provider: "github";
  readonly repository: {
    readonly owner: string;
    readonly name: string;
  };
  readonly number: number;
  readonly title: string;
  readonly description: string | null;
  readonly state: "open" | "closed" | "merged";
  readonly author: GitHubPullRequestAuthor;
  readonly base: {
    readonly ref: string;
    readonly sha: string;
  };
  readonly head: {
    readonly ref: string;
    readonly sha: string;
  };
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly url: string;
}

export interface GitHubChangedFile {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
  readonly language?: string;
}

export interface GitHubFileDiffHunk {
  readonly oldStart: number;
  readonly oldLineCount: number;
  readonly newStart: number;
  readonly newLineCount: number;
  readonly sectionHeading?: string;
  readonly lines: readonly {
    readonly kind: "context" | "addition" | "deletion";
    readonly content: string;
    readonly oldLineNumber?: number;
    readonly newLineNumber?: number;
    readonly noNewlineAtEnd?: boolean;
  }[];
}

export interface GitHubFileDiff {
  readonly path: string;
  readonly previousPath?: string;
  readonly status: GitHubChangedFile["status"];
  readonly binary: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: readonly GitHubFileDiffHunk[];
}

export interface GitHubFileReviewDecision {
  readonly include: boolean;
  readonly reason?:
    | "binary"
    | "generated-file"
    | "lockfile"
    | "vendored"
    | "minified"
    | "snapshot"
    | "budget"
    | "unsupported";
}

export interface GitHubPullRequestDiffSet {
  readonly files: readonly GitHubChangedFile[];
  readonly diffs: readonly GitHubFileDiff[];
  readonly decisions: readonly {
    readonly file: GitHubChangedFile;
    readonly decision: GitHubFileReviewDecision;
  }[];
}

export interface InspectedPluginPackage {
  readonly source: PluginInstallation["source"];
  readonly manifestPath: string;
  readonly manifest: PluginManifest;
}

const buildQuery = (parameters: Record<string, string | undefined>): string => {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(parameters)) {
    if (value) {
      search.set(key, value);
    }
  }

  const query = search.toString();
  return query.length > 0 ? `?${query}` : "";
};

export class DesktopBackendClient {
  listPlugins(): Promise<{ readonly plugins: readonly InstalledPlugin[] }> {
    return requestDesktopBackend("/plugins");
  }

  getPlugin(pluginId: string): Promise<{ readonly plugin: InstalledPlugin }> {
    return requestDesktopBackend(`/plugins${buildQuery({ pluginId })}`);
  }

  inspectLocalPlugin(
    packagePath: string
  ): Promise<{ readonly package: InspectedPluginPackage }> {
    return requestDesktopBackend("/plugins/inspect-local", {
      method: "POST",
      body: JSON.stringify({ packagePath })
    });
  }

  registerLocalPlugin(
    packagePath: string
  ): Promise<{ readonly plugin: InstalledPlugin }> {
    return requestDesktopBackend("/plugins/register-local", {
      method: "POST",
      body: JSON.stringify({ packagePath })
    });
  }

  unregisterPlugin(pluginId: string): Promise<{ readonly ok: boolean }> {
    return requestDesktopBackend("/plugins/unregister", {
      method: "POST",
      body: JSON.stringify({ pluginId })
    });
  }

  enablePlugin(
    pluginId: string,
    sessionId?: string
  ): Promise<{ readonly plugin: InstalledPlugin }> {
    return requestDesktopBackend("/plugins/enable", {
      method: "POST",
      body: JSON.stringify({
        pluginId,
        ...(sessionId ? { sessionId } : {})
      })
    });
  }

  disablePlugin(
    pluginId: string
  ): Promise<{ readonly plugin: InstalledPlugin }> {
    return requestDesktopBackend("/plugins/disable", {
      method: "POST",
      body: JSON.stringify({ pluginId })
    });
  }

  getPluginRuntime(
    pluginId: string
  ): Promise<{ readonly runtime: PluginRuntimeHealthSnapshot | null }> {
    return requestDesktopBackend(`/plugins/runtime${buildQuery({ pluginId })}`);
  }

  startPluginRuntime(
    pluginId: string
  ): Promise<{ readonly runtime: PluginRuntimeHealthSnapshot }> {
    return requestDesktopBackend("/plugins/runtime/start", {
      method: "POST",
      body: JSON.stringify({ pluginId })
    });
  }

  stopPluginRuntime(
    pluginId: string
  ): Promise<{ readonly runtime: PluginRuntimeHealthSnapshot }> {
    return requestDesktopBackend("/plugins/runtime/stop", {
      method: "POST",
      body: JSON.stringify({ pluginId })
    });
  }

  getPermissionReview(
    pluginId: string,
    sessionId?: string
  ): Promise<{ readonly review: PluginPermissionReviewSnapshot }> {
    return requestDesktopBackend(
      `/plugins/permissions/review${buildQuery({ pluginId, sessionId })}`
    );
  }

  grantPermissions(
    request: GrantPluginPermissionsRequest
  ): Promise<{ readonly review: PluginPermissionReviewSnapshot }> {
    return requestDesktopBackend("/plugins/permissions/grant", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  revokePermission(
    request: RevokePluginPermissionRequest
  ): Promise<{ readonly review: PluginPermissionReviewSnapshot }> {
    return requestDesktopBackend("/plugins/permissions/revoke", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  readPluginConfiguration(
    pluginId: string,
    key: string
  ): Promise<{ readonly configuration: unknown }> {
    return requestDesktopBackend("/plugins/runtime/read-configuration", {
      method: "POST",
      body: JSON.stringify({ pluginId, key })
    });
  }

  listAuditEvents(options?: {
    readonly limit?: number;
    readonly pluginId?: string;
    readonly action?: string;
  }): Promise<{ readonly events: readonly AuditEvent[] }> {
    return requestDesktopBackend(
      `/audit${buildQuery({
        limit: options?.limit?.toString(),
        pluginId: options?.pluginId,
        action: options?.action
      })}`
    );
  }

  listLogs(options?: {
    readonly limit?: number;
    readonly pluginId?: string;
    readonly registrationId?: string;
  }): Promise<{ readonly logs: readonly PersistedLogEntry[] }> {
    return requestDesktopBackend(
      `/logs${buildQuery({
        limit: options?.limit?.toString(),
        pluginId: options?.pluginId,
        registrationId: options?.registrationId
      })}`
    );
  }

  listMcpServers(options?: {
    readonly pluginId?: string;
  }): Promise<{ readonly servers: readonly RegisteredMcpServer[] }> {
    return requestDesktopBackend(
      `/mcp/servers${buildQuery({ pluginId: options?.pluginId })}`
    );
  }

  getMcpHealth(options?: {
    readonly pluginId?: string;
  }): Promise<{ readonly servers: readonly McpServerHealthSnapshot[] }> {
    return requestDesktopBackend(
      `/mcp/health${buildQuery({ pluginId: options?.pluginId })}`
    );
  }

  listMcpTools(options?: {
    readonly pluginId?: string;
    readonly serverId?: string;
  }): Promise<{ readonly tools: readonly ToolDescriptor[] }> {
    return requestDesktopBackend(
      `/mcp/tools${buildQuery({
        pluginId: options?.pluginId,
        serverId: options?.serverId
      })}`
    );
  }

  listMcpResources(options?: {
    readonly pluginId?: string;
    readonly serverId?: string;
  }): Promise<{ readonly resources: readonly ResourceDescriptor[] }> {
    return requestDesktopBackend(
      `/mcp/resources${buildQuery({
        pluginId: options?.pluginId,
        serverId: options?.serverId
      })}`
    );
  }

  listMcpPrompts(options?: {
    readonly pluginId?: string;
    readonly serverId?: string;
  }): Promise<{ readonly prompts: readonly PromptDescriptor[] }> {
    return requestDesktopBackend(
      `/mcp/prompts${buildQuery({
        pluginId: options?.pluginId,
        serverId: options?.serverId
      })}`
    );
  }

  registerMcpServer(
    registration: McpServerRegistration
  ): Promise<{ readonly server: RegisteredMcpServer }> {
    return requestDesktopBackend("/mcp/servers/register", {
      method: "POST",
      body: JSON.stringify({ registration })
    });
  }

  unregisterMcpServer(
    registrationId: string
  ): Promise<{ readonly ok: boolean }> {
    return requestDesktopBackend("/mcp/servers/unregister", {
      method: "POST",
      body: JSON.stringify({ registrationId })
    });
  }

  startMcpServer(
    registrationId: string
  ): Promise<{ readonly server: RegisteredMcpServer }> {
    return requestDesktopBackend("/mcp/servers/start", {
      method: "POST",
      body: JSON.stringify({ registrationId })
    });
  }

  stopMcpServer(
    registrationId: string
  ): Promise<{ readonly server: RegisteredMcpServer }> {
    return requestDesktopBackend("/mcp/servers/stop", {
      method: "POST",
      body: JSON.stringify({ registrationId })
    });
  }

  executeMcpTool(
    request: ToolExecutionRequest
  ): Promise<{ readonly result: ToolExecutionResult }> {
    return requestDesktopBackend("/mcp/tools/execute", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  listToolExecutions(options?: {
    readonly limit?: number;
    readonly serverId?: string;
    readonly toolId?: string;
  }): Promise<{ readonly executions: readonly McpToolExecutionRecord[] }> {
    return requestDesktopBackend(
      `/mcp/tool-executions${buildQuery({
        limit: options?.limit?.toString(),
        serverId: options?.serverId,
        toolId: options?.toolId
      })}`
    );
  }

  listWorkspaces(): Promise<{
    readonly workspaces: readonly EngineeringWorkspace[];
  }> {
    return requestDesktopBackend("/workspaces");
  }

  createWorkspace(name: string): Promise<{
    readonly workspace: EngineeringWorkspace;
  }> {
    return requestDesktopBackend("/workspaces", {
      method: "POST",
      body: JSON.stringify({ name })
    });
  }

  listGitHubConnections(workspaceId: string): Promise<{
    readonly connections: readonly GitHubConnectionRecord[];
  }> {
    return requestDesktopBackend(
      `/github/connections${buildQuery({ workspaceId })}`
    );
  }

  createGitHubConnection(request: {
    readonly workspaceId: string;
    readonly displayName: string;
    readonly token: string;
  }): Promise<{ readonly connection: GitHubConnectionRecord }> {
    return requestDesktopBackend("/github/connections", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  disconnectGitHubConnection(request: {
    readonly workspaceId: string;
    readonly connectionId: string;
  }): Promise<{ readonly connection: GitHubConnectionRecord }> {
    return requestDesktopBackend("/github/connections/disconnect", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  verifyGitHubConnection(request: {
    readonly workspaceId: string;
    readonly connectionId: string;
  }): Promise<{ readonly connection: GitHubConnectionRecord }> {
    return requestDesktopBackend("/github/connections/verify", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  listGitHubRepositories(request: {
    readonly workspaceId: string;
    readonly connectionId: string;
  }): Promise<{ readonly repositories: readonly GitHubRepository[] }> {
    return requestDesktopBackend(
      `/github/repositories${buildQuery({
        workspaceId: request.workspaceId,
        connectionId: request.connectionId
      })}`
    );
  }

  listGitHubPullRequests(request: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly owner: string;
    readonly repository: string;
    readonly state?: "open" | "closed" | "all";
  }): Promise<{ readonly pullRequests: readonly GitHubPullRequest[] }> {
    return requestDesktopBackend(
      `/github/pull-requests${buildQuery({
        workspaceId: request.workspaceId,
        connectionId: request.connectionId,
        owner: request.owner,
        repository: request.repository,
        state: request.state
      })}`
    );
  }

  getGitHubPullRequest(request: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly owner: string;
    readonly repository: string;
    readonly pullRequestNumber: number;
  }): Promise<{ readonly pullRequest: GitHubPullRequest }> {
    return requestDesktopBackend(
      `/github/pull-request${buildQuery({
        workspaceId: request.workspaceId,
        connectionId: request.connectionId,
        owner: request.owner,
        repository: request.repository,
        pullRequestNumber: String(request.pullRequestNumber)
      })}`
    );
  }

  getGitHubPullRequestFiles(request: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly owner: string;
    readonly repository: string;
    readonly pullRequestNumber: number;
  }): Promise<{ readonly diffSet: GitHubPullRequestDiffSet }> {
    return requestDesktopBackend(
      `/github/pull-request/files${buildQuery({
        workspaceId: request.workspaceId,
        connectionId: request.connectionId,
        owner: request.owner,
        repository: request.repository,
        pullRequestNumber: String(request.pullRequestNumber)
      })}`
    );
  }
}

export const desktopBackendClient = new DesktopBackendClient();
