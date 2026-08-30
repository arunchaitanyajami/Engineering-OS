import type { PluginManifest } from "@engineering-os/contracts";
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
}

export const desktopBackendClient = new DesktopBackendClient();
