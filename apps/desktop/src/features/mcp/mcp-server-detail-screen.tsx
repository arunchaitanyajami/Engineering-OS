import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  PanelCard
} from "@engineering-os/ui";

import {
  BackendUnavailableNotice,
  FeatureErrorState,
  FeatureLoadingState,
  formatJson,
  riskBadgeTone
} from "../shared/feature-states.js";
import { useAsyncResource } from "../../hooks/use-async-resource.js";
import { desktopBackendClient } from "../../services/desktop-backend-client.js";
import { isDesktopBackendAvailable } from "../../services/desktop-backend-request.js";

type McpDetailTab = "overview" | "tools" | "resources" | "prompts" | "diagnostics";

export function McpServerDetailScreen() {
  const { registrationId = "" } = useParams();
  const decodedRegistrationId = decodeURIComponent(registrationId);
  const [activeTab, setActiveTab] = useState<McpDetailTab>("overview");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const loadDetail = useCallback(async () => {
    const serversResponse = await desktopBackendClient.listMcpServers();
    const server = serversResponse.servers.find(
      (entry) => entry.registrationId === decodedRegistrationId
    );

    if (!server) {
      throw new Error(`MCP server '${decodedRegistrationId}' was not found.`);
    }

    const pluginId =
      server.source.type === "plugin" ? server.source.pluginId : undefined;

    const [healthResponse, toolsResponse, resourcesResponse, promptsResponse, executionsResponse] =
      await Promise.all([
        desktopBackendClient.getMcpHealth({
          ...(pluginId ? { pluginId } : {})
        }),
        desktopBackendClient.listMcpTools({
          serverId: server.serverId,
          ...(pluginId ? { pluginId } : {})
        }),
        desktopBackendClient.listMcpResources({
          serverId: server.serverId,
          ...(pluginId ? { pluginId } : {})
        }),
        desktopBackendClient.listMcpPrompts({
          serverId: server.serverId,
          ...(pluginId ? { pluginId } : {})
        }),
        desktopBackendClient.listToolExecutions({
          limit: 20,
          serverId: server.serverId
        })
      ]);

    return {
      server,
      health:
        healthResponse.servers.find(
          (entry) => entry.registrationId === decodedRegistrationId
        ) ?? null,
      tools: toolsResponse.tools,
      resources: resourcesResponse.resources,
      prompts: promptsResponse.prompts,
      executions: executionsResponse.executions
    };
  }, [decodedRegistrationId]);

  const { data, error, isLoading, reload } = useAsyncResource(
    loadDetail,
    [decodedRegistrationId]
  );

  if (!isDesktopBackendAvailable()) {
    return <BackendUnavailableNotice />;
  }

  if (!decodedRegistrationId) {
    return (
      <FeatureErrorState
        title="MCP server not specified"
        description="Choose a registered MCP server from the gateway list."
      />
    );
  }

  if (isLoading) {
    return (
      <FeatureLoadingState
        title="Loading MCP server"
        description={`Fetching catalog and diagnostics for ${decodedRegistrationId}.`}
      />
    );
  }

  if (error || !data) {
    return (
      <FeatureErrorState
        title="Unable to load MCP server"
        description={error ?? "MCP server detail request failed."}
        onRetry={reload}
      />
    );
  }

  const { server, health, tools, resources, prompts, executions } = data;

  const runAction = async (action: () => Promise<unknown>) => {
    setIsBusy(true);
    setActionError(null);

    try {
      await action();
      reload();
    } catch (actionFailure) {
      setActionError(
        actionFailure instanceof Error
          ? actionFailure.message
          : "MCP server action failed."
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="MCP Servers"
        title={server.name}
        description={`${server.serverId} · ${server.registrationId}`}
        actions={
          <div className="ui-page-header__actions">
            <Link className="ui-button ui-button--ghost" to="/mcp/servers">
              Back to servers
            </Link>
            <Button
              disabled={isBusy}
              onClick={() =>
                void runAction(() =>
                  desktopBackendClient.startMcpServer(decodedRegistrationId)
                )
              }
            >
              Start
            </Button>
            <Button
              className="ui-button--ghost"
              disabled={isBusy}
              onClick={() =>
                void runAction(() =>
                  desktopBackendClient.stopMcpServer(decodedRegistrationId)
                )
              }
            >
              Stop
            </Button>
          </div>
        }
      />

      {actionError ? <p className="ui-error-text">{actionError}</p> : null}

      <div className="tab-row">
        {(
          [
            ["overview", "Overview"],
            ["tools", "Tools"],
            ["resources", "Resources"],
            ["prompts", "Prompts"],
            ["diagnostics", "Diagnostics"]
          ] as const
        ).map(([tab, label]) => (
          <button
            className={
              activeTab === tab ? "tab-button tab-button--active" : "tab-button"
            }
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div className="content-grid">
          <PanelCard eyebrow="Registration" title="Server configuration">
            <pre className="code-block">{formatJson(server)}</pre>
          </PanelCard>
          <PanelCard eyebrow="Health" title="Gateway status">
            {health ? (
              <pre className="code-block">{formatJson(health)}</pre>
            ) : (
              <EmptyState
                title="Health unavailable"
                description="Start the server to populate gateway health diagnostics."
              />
            )}
          </PanelCard>
          <PanelCard eyebrow="Lifecycle" title="Maintenance">
            <div className="action-row">
              <Button
                className="ui-button--ghost"
                disabled={isBusy}
                onClick={() =>
                  void runAction(() =>
                    desktopBackendClient.unregisterMcpServer(decodedRegistrationId)
                  )
                }
              >
                Unregister server
              </Button>
              <Link
                className="ui-button"
                to={`/mcp/tool-console?serverId=${encodeURIComponent(server.serverId)}`}
              >
                Open tool console
              </Link>
            </div>
          </PanelCard>
        </div>
      ) : null}

      {activeTab === "tools" ? (
        <PanelCard eyebrow="Discovery" title="Discovered tools">
          {tools.length === 0 ? (
            <EmptyState
              title="No tools discovered"
              description="Start the MCP server and refresh after capability discovery completes."
            />
          ) : (
            <div className="stack-list">
              {tools.map((tool) => (
                <div className="list-note" key={tool.id}>
                  <div className="list-link-card__header">
                    <strong>{tool.name}</strong>
                    <Badge tone={riskBadgeTone(tool.riskLevel)}>
                      {tool.riskLevel}
                    </Badge>
                  </div>
                  <span className="ui-muted">{tool.description ?? tool.id}</span>
                  <Link
                    className="ui-button ui-button--ghost"
                    to={`/mcp/tool-console?toolId=${encodeURIComponent(tool.id)}&serverId=${encodeURIComponent(tool.serverId)}`}
                  >
                    Test in console
                  </Link>
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      ) : null}

      {activeTab === "resources" ? (
        <PanelCard eyebrow="Discovery" title="Resources">
          {resources.length === 0 ? (
            <EmptyState
              title="No resources discovered"
              description="This server has not published MCP resources yet."
            />
          ) : (
            <div className="stack-list">
              {resources.map((resource) => (
                <div className="list-note" key={resource.id}>
                  <strong>{resource.name}</strong>
                  <span className="ui-muted">{resource.uri}</span>
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      ) : null}

      {activeTab === "prompts" ? (
        <PanelCard eyebrow="Discovery" title="Prompts">
          {prompts.length === 0 ? (
            <EmptyState
              title="No prompts discovered"
              description="This server has not published MCP prompts yet."
            />
          ) : (
            <div className="stack-list">
              {prompts.map((prompt) => (
                <div className="list-note" key={prompt.id}>
                  <strong>{prompt.name}</strong>
                  <span className="ui-muted">
                    {prompt.description ?? prompt.id}
                  </span>
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      ) : null}

      {activeTab === "diagnostics" ? (
        <PanelCard eyebrow="Executions" title="Recent tool executions">
          {executions.length === 0 ? (
            <EmptyState
              title="No executions recorded"
              description="Run a tool from the console to populate execution diagnostics."
            />
          ) : (
            <div className="stack-list">
              {executions.map((execution) => (
                <div className="list-note" key={execution.executionId}>
                  <strong>{execution.toolId}</strong>
                  <span className="ui-muted">
                    {execution.state} · {execution.startedAt}
                  </span>
                  {execution.result ? (
                    <pre className="code-block">{formatJson(execution.result)}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      ) : null}
    </div>
  );
}
