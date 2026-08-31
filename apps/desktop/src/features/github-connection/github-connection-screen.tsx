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
import {
  desktopBackendClient,
  type EngineeringWorkspace,
  type GitHubConnectionRecord,
  type GitHubConnectionStatus,
  type InstalledPlugin
} from "../../services/desktop-backend-client.js";
import { isDesktopBackendAvailable } from "../../services/desktop-backend-request.js";

export const githubPluginId = "com.engineering-os.github";

const connectionStatusTone = (
  status: GitHubConnectionStatus
): "success" | "warning" | "error" | "neutral" => {
  switch (status) {
    case "connected":
      return "success";
    case "expired":
    case "error":
      return "error";
    case "disconnected":
      return "neutral";
  }
};

const connectionStatusLabel = (status: GitHubConnectionStatus): string => {
  switch (status) {
    case "connected":
      return "Connected";
    case "disconnected":
      return "Disconnected";
    case "expired":
      return "Expired";
    case "error":
      return "Authentication error";
  }
};

export function GitHubConnectionScreen() {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const loadPage = useCallback(async () => {
    const [pluginsResponse, workspacesResponse] = await Promise.all([
      desktopBackendClient.listPlugins(),
      desktopBackendClient.listWorkspaces()
    ]);
    const plugin =
      pluginsResponse.plugins.find(
        (candidate) => candidate.pluginId === githubPluginId
      ) ?? null;
    const review = plugin
      ? (await desktopBackendClient.getPermissionReview(plugin.pluginId)).review
      : null;

    return {
      plugin,
      review,
      workspaces: workspacesResponse.workspaces
    };
  }, []);

  const { data, error, isLoading, reload } = useAsyncResource(loadPage, []);

  const activeWorkspaceId = useMemo(() => {
    if (!data) {
      return "";
    }

    if (
      selectedWorkspaceId &&
      data.workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ) {
      return selectedWorkspaceId;
    }

    return data.workspaces[0]?.id ?? "";
  }, [data, selectedWorkspaceId]);

  const loadConnections = useCallback(async () => {
    if (!activeWorkspaceId) {
      return { connections: [] as readonly GitHubConnectionRecord[] };
    }

    return desktopBackendClient.listGitHubConnections(activeWorkspaceId);
  }, [activeWorkspaceId]);

  const connectionsResource = useAsyncResource(loadConnections, [
    activeWorkspaceId
  ]);

  const runAction = async (action: () => Promise<unknown>) => {
    setIsBusy(true);
    setActionError(null);

    try {
      await action();
    } catch (actionFailure) {
      setActionError(
        actionFailure instanceof Error
          ? actionFailure.message
          : "GitHub connection action failed."
      );
    } finally {
      setIsBusy(false);
    }
  };

  if (!isDesktopBackendAvailable()) {
    return <BackendUnavailableNotice />;
  }

  if (isLoading) {
    return (
      <FeatureLoadingState
        title="Loading GitHub integration"
        description="Fetching plugin status, workspaces, and connection records."
      />
    );
  }

  if (error || !data) {
    return (
      <FeatureErrorState
        title="Unable to load GitHub integration"
        description={error ?? "GitHub connection request failed."}
        onRetry={reload}
      />
    );
  }

  const { plugin, review, workspaces } = data;
  const connections = connectionsResource.data?.connections ?? [];

  const grantPendingPermissions = async () => {
    if (!plugin || !review || review.pendingRequirements.length === 0) {
      return;
    }

    await runAction(async () => {
      await desktopBackendClient.grantPermissions({
        pluginId: plugin.pluginId,
        grants: review.pendingRequirements.map((requirement) => ({
          scope: requirement.scope,
          decision: "always-allow" as const,
          ...(requirement.constraint
            ? { constraint: requirement.constraint }
            : {})
        }))
      });
      reload();
    });
  };

  const togglePluginEnabled = async () => {
    if (!plugin) {
      return;
    }

    await runAction(async () => {
      if (plugin.enabled) {
        await desktopBackendClient.disablePlugin(plugin.pluginId);
      } else {
        await desktopBackendClient.enablePlugin(plugin.pluginId);
      }
      reload();
    });
  };

  const createWorkspace = async () => {
    const name = workspaceName.trim();

    if (!name) {
      setActionError("Enter a workspace name before creating it.");
      return;
    }

    await runAction(async () => {
      const response = await desktopBackendClient.createWorkspace(name);
      setWorkspaceName("");
      setSelectedWorkspaceId(response.workspace.id);
      reload();
    });
  };

  const createConnection = async () => {
    if (!activeWorkspaceId) {
      setActionError("Create or select a workspace before connecting GitHub.");
      return;
    }

    const name = displayName.trim();
    const personalAccessToken = token.trim();

    if (!name || !personalAccessToken) {
      setActionError(
        "Enter a connection name and a GitHub personal access token."
      );
      return;
    }

    await runAction(async () => {
      await desktopBackendClient.createGitHubConnection({
        workspaceId: activeWorkspaceId,
        displayName: name,
        token: personalAccessToken
      });
      setDisplayName("");
      setToken("");
      connectionsResource.reload();
    });
  };

  const disconnectConnection = async (connection: GitHubConnectionRecord) => {
    await runAction(async () => {
      await desktopBackendClient.disconnectGitHubConnection({
        workspaceId: connection.workspaceId,
        connectionId: connection.id
      });
      connectionsResource.reload();
    });
  };

  const verifyConnection = async (connection: GitHubConnectionRecord) => {
    await runAction(async () => {
      try {
        await desktopBackendClient.verifyGitHubConnection({
          workspaceId: connection.workspaceId,
          connectionId: connection.id
        });
      } finally {
        connectionsResource.reload();
      }
    });
  };

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Integrations"
        title="GitHub"
        description="Enable the GitHub plugin and assign a workspace-scoped connection. Credentials stay in the local secret store."
        actions={
          <Link
            className="ui-button ui-button--ghost"
            to="/integrations/github/browse"
          >
            Browse repositories
          </Link>
        }
      />

      {actionError ? <p className="ui-error-text">{actionError}</p> : null}

      <div className="content-grid">
        <PluginStatusCard
          isBusy={isBusy}
          onEnable={togglePluginEnabled}
          onGrantPermissions={grantPendingPermissions}
          plugin={plugin}
          reviewCanEnable={review?.canEnable ?? false}
          pendingCount={review?.pendingRequirements.length ?? 0}
          permissions={plugin?.manifest.permissions ?? []}
        />

        <WorkspaceAssignmentCard
          activeWorkspaceId={activeWorkspaceId}
          isBusy={isBusy}
          onCreateWorkspace={() => void createWorkspace()}
          onSelectWorkspace={setSelectedWorkspaceId}
          workspaceName={workspaceName}
          workspaces={workspaces}
          onWorkspaceNameChange={setWorkspaceName}
        />

        <PanelCard eyebrow="Connection" title="Create GitHub connection">
          {!plugin ? (
            <EmptyState
              title="GitHub plugin is not installed"
              description="Register the GitHub plugin from the Plugins screen before creating a connection."
              action={
                <Link className="ui-button" to="/plugins">
                  Open plugins
                </Link>
              }
            />
          ) : (
            <>
              <label className="form-field">
                <span>Display name</span>
                <input
                  className="app-input"
                  disabled={isBusy || !activeWorkspaceId}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Company A GitHub"
                  value={displayName}
                />
              </label>
              <label className="form-field">
                <span>Personal access token</span>
                <input
                  autoComplete="off"
                  className="app-input"
                  disabled={isBusy || !activeWorkspaceId}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="ghp_…"
                  type="password"
                  value={token}
                />
              </label>
              <p className="ui-muted">
                The token is stored as a secret reference. It is never written
                to SQLite or returned to the UI after connect.
              </p>
              <div className="action-row">
                <Button
                  disabled={isBusy || !activeWorkspaceId}
                  onClick={() => void createConnection()}
                >
                  Connect GitHub
                </Button>
              </div>
            </>
          )}
        </PanelCard>

        <PanelCard eyebrow="Status" title="Workspace connections">
          {!activeWorkspaceId ? (
            <EmptyState
              title="No workspace selected"
              description="Create a workspace to own a GitHub connection. Two workspaces stay isolated."
            />
          ) : connectionsResource.isLoading ? (
            <p className="ui-muted">Loading connections for this workspace.</p>
          ) : connectionsResource.error ? (
            <p className="ui-error-text">{connectionsResource.error}</p>
          ) : connections.length === 0 ? (
            <EmptyState
              title="No GitHub connection"
              description="Connect a GitHub account to this workspace. Other workspaces cannot see this connection."
            />
          ) : (
            <div className="stack-list">
              {connections.map((connection) => (
                <ConnectionCard
                  connection={connection}
                  isBusy={isBusy}
                  key={connection.id}
                  onDisconnect={() => void disconnectConnection(connection)}
                  onVerify={() => void verifyConnection(connection)}
                />
              ))}
            </div>
          )}
        </PanelCard>
      </div>
    </div>
  );
}

function PluginStatusCard({
  plugin,
  isBusy,
  onEnable,
  onGrantPermissions,
  pendingCount,
  permissions,
  reviewCanEnable
}: {
  readonly plugin: InstalledPlugin | null;
  readonly isBusy: boolean;
  readonly onEnable: () => Promise<void>;
  readonly onGrantPermissions: () => Promise<void>;
  readonly pendingCount: number;
  readonly permissions: InstalledPlugin["manifest"]["permissions"];
  readonly reviewCanEnable: boolean;
}) {
  return (
    <PanelCard eyebrow="Plugin" title="GitHub plugin">
      {!plugin ? (
        <EmptyState
          title="Not installed"
          description="Register the local GitHub plugin package, then return here to enable it and create a connection."
          action={
            <Link className="ui-button" to="/plugins">
              Open plugins
            </Link>
          }
        />
      ) : (
        <div className="stack-list">
          <div className="summary-list">
            <div className="summary-list__row">
              <span>Plugin ID</span>
              <span>{plugin.pluginId}</span>
            </div>
            <div className="summary-list__row">
              <span>State</span>
              <Badge tone={plugin.enabled ? "success" : "neutral"}>
                {plugin.enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <div className="summary-list__row">
              <span>Permission review</span>
              <Badge tone={reviewCanEnable ? "success" : "warning"}>
                {reviewCanEnable ? "Ready to enable" : "Pending grants"}
              </Badge>
            </div>
          </div>
          <div className="action-row">
            {pendingCount > 0 ? (
              <Button
                disabled={isBusy}
                onClick={() => void onGrantPermissions()}
              >
                Grant pending permissions
              </Button>
            ) : null}
            <Button disabled={isBusy} onClick={() => void onEnable()}>
              {plugin.enabled ? "Disable plugin" : "Enable plugin"}
            </Button>
          </div>
          <div className="stack-list">
            <strong>Declared permissions</strong>
            {permissions.length === 0 ? (
              <span className="ui-muted">No permissions declared.</span>
            ) : (
              permissions.map((permission) => (
                <div className="list-note" key={permission.scope}>
                  <strong>{permission.scope}</strong>
                  <span className="ui-muted">{permission.reason}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </PanelCard>
  );
}

function WorkspaceAssignmentCard({
  activeWorkspaceId,
  isBusy,
  onCreateWorkspace,
  onSelectWorkspace,
  onWorkspaceNameChange,
  workspaceName,
  workspaces
}: {
  readonly activeWorkspaceId: string;
  readonly isBusy: boolean;
  readonly onCreateWorkspace: () => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onWorkspaceNameChange: (value: string) => void;
  readonly workspaceName: string;
  readonly workspaces: readonly EngineeringWorkspace[];
}) {
  return (
    <PanelCard eyebrow="Workspace" title="Workspace assignment">
      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          description="Create a workspace so the GitHub connection is owned by that workspace instead of a global token."
        />
      ) : (
        <label className="form-field" htmlFor="github-active-workspace">
          <span>Active workspace</span>
          <select
            className="app-select"
            disabled={isBusy}
            id="github-active-workspace"
            onChange={(event) => onSelectWorkspace(event.target.value)}
            value={activeWorkspaceId}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="form-field">
        <span>New workspace name</span>
        <input
          className="app-input"
          disabled={isBusy}
          onChange={(event) => onWorkspaceNameChange(event.target.value)}
          placeholder="Personal"
          value={workspaceName}
        />
      </label>
      <div className="action-row">
        <Button disabled={isBusy} onClick={onCreateWorkspace}>
          Create workspace
        </Button>
      </div>
    </PanelCard>
  );
}

function ConnectionCard({
  connection,
  isBusy,
  onDisconnect,
  onVerify
}: {
  readonly connection: GitHubConnectionRecord;
  readonly isBusy: boolean;
  readonly onDisconnect: () => void;
  readonly onVerify: () => void;
}) {
  return (
    <div className="list-note">
      <div className="list-link-card__header">
        <strong>{connection.displayName}</strong>
        <Badge tone={connectionStatusTone(connection.status)}>
          {connectionStatusLabel(connection.status)}
        </Badge>
      </div>
      <span className="ui-muted">Workspace {connection.workspaceId}</span>
      {connection.accountLogin ? (
        <span className="ui-muted">
          Authenticated as {connection.accountLogin}
        </span>
      ) : null}
      {connection.lastError ? (
        <p className="ui-error-text">{connection.lastError}</p>
      ) : null}
      <div className="action-row">
        {connection.status === "connected" ? (
          <Link
            className="ui-button ui-button--ghost"
            to={`/integrations/github/browse?workspaceId=${encodeURIComponent(connection.workspaceId)}&connectionId=${encodeURIComponent(connection.id)}`}
          >
            Browse repositories
          </Link>
        ) : null}
        {connection.status !== "disconnected" ? (
          <Button
            className="ui-button--ghost"
            disabled={isBusy}
            onClick={onVerify}
          >
            Verify
          </Button>
        ) : null}
        <Button disabled={isBusy} onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}
