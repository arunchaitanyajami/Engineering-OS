import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

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
  FeatureLoadingState
} from "../shared/feature-states.js";
import { useAsyncResource } from "../../hooks/use-async-resource.js";
import { desktopBackendClient } from "../../services/desktop-backend-client.js";
import { isDesktopBackendAvailable } from "../../services/desktop-backend-request.js";

const healthTone = (
  state: string
): "success" | "warning" | "error" | "neutral" => {
  switch (state) {
    case "healthy":
      return "success";
    case "unhealthy":
      return "error";
    default:
      return "neutral";
  }
};

export function McpServersScreen() {
  const [serverId, setServerId] = useState("");
  const [serverName, setServerName] = useState("");
  const [command, setCommand] = useState("node");
  const [args, setArgs] = useState("./dist/server.js");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  const loadServers = useCallback(async () => {
    const [serversResponse, healthResponse] = await Promise.all([
      desktopBackendClient.listMcpServers(),
      desktopBackendClient.getMcpHealth()
    ]);

    const healthByRegistrationId = new Map(
      healthResponse.servers.map((entry) => [entry.registrationId, entry])
    );

    return {
      servers: serversResponse.servers,
      healthByRegistrationId
    };
  }, []);

  const { data, error, isLoading, reload } = useAsyncResource(loadServers, []);

  const sortedServers = useMemo(
    () =>
      data
        ? [...data.servers].sort((left, right) =>
            left.name.localeCompare(right.name)
          )
        : [],
    [data]
  );

  if (!isDesktopBackendAvailable()) {
    return <BackendUnavailableNotice />;
  }

  if (isLoading) {
    return (
      <FeatureLoadingState
        title="Loading MCP servers"
        description="Fetching registered MCP servers and gateway health snapshots."
      />
    );
  }

  if (error || !data) {
    return (
      <FeatureErrorState
        title="Unable to load MCP servers"
        description={error ?? "MCP gateway request failed."}
        onRetry={reload}
      />
    );
  }

  const handleRegister = async () => {
    const trimmedServerId = serverId.trim();
    const trimmedName = serverName.trim();
    const trimmedCommand = command.trim();

    if (!trimmedServerId || !trimmedName || !trimmedCommand) {
      setActionError("Server ID, display name, and command are required.");
      return;
    }

    setIsRegistering(true);
    setActionError(null);

    try {
      await desktopBackendClient.registerMcpServer({
        id: trimmedServerId,
        name: trimmedName,
        source: { type: "user" },
        enabled: true,
        transport: {
          type: "stdio",
          command: trimmedCommand,
          args: args
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        }
      });
      setServerId("");
      setServerName("");
      reload();
    } catch (registerError) {
      setActionError(
        registerError instanceof Error
          ? registerError.message
          : "MCP server registration failed."
      );
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Settings"
        title="MCP Servers"
        description="Register, start, and inspect MCP servers discovered through the local gateway."
        actions={
          <Link className="ui-button ui-button--ghost" to="/mcp/tool-console">
            Open tool console
          </Link>
        }
      />

      <div className="content-grid">
        <PanelCard eyebrow="Register" title="Add local MCP server">
          <label className="form-field">
            <span>Server ID</span>
            <input
              className="app-input"
              onChange={(event) => setServerId(event.target.value)}
              placeholder="filesystem"
              value={serverId}
            />
          </label>
          <label className="form-field">
            <span>Display name</span>
            <input
              className="app-input"
              onChange={(event) => setServerName(event.target.value)}
              placeholder="Filesystem MCP"
              value={serverName}
            />
          </label>
          <label className="form-field">
            <span>Command</span>
            <input
              className="app-input"
              onChange={(event) => setCommand(event.target.value)}
              value={command}
            />
          </label>
          <label className="form-field">
            <span>Args (comma separated)</span>
            <input
              className="app-input"
              onChange={(event) => setArgs(event.target.value)}
              value={args}
            />
          </label>
          {actionError ? <p className="ui-error-text">{actionError}</p> : null}
          <div className="action-row">
            <Button
              disabled={isRegistering}
              onClick={() => void handleRegister()}
            >
              {isRegistering ? "Registering…" : "Register server"}
            </Button>
          </div>
        </PanelCard>

        <PanelCard eyebrow="Registered" title="Gateway servers">
          {sortedServers.length === 0 ? (
            <EmptyState
              title="No MCP servers registered"
              description="Install a plugin with MCP declarations or register a local stdio server."
            />
          ) : (
            <div className="stack-list">
              {sortedServers.map((server) => {
                const health = data.healthByRegistrationId.get(
                  server.registrationId
                );

                return (
                  <Link
                    className="list-link-card"
                    key={server.registrationId}
                    to={`/mcp/servers/${encodeURIComponent(server.registrationId)}`}
                  >
                    <div className="list-link-card__header">
                      <strong>{server.name}</strong>
                      <Badge
                        tone={
                          health ? healthTone(health.healthState) : "neutral"
                        }
                      >
                        {health?.healthState ?? "unknown"}
                      </Badge>
                    </div>
                    <span className="ui-muted">{server.registrationId}</span>
                    <span className="ui-muted">
                      {server.source.type} ·{" "}
                      {server.enabled ? "enabled" : "disabled"}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </PanelCard>
      </div>
    </div>
  );
}
