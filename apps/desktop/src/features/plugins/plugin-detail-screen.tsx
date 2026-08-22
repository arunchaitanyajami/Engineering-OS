import { useCallback, useMemo, useState } from "react";
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
  formatJson
} from "../shared/feature-states.js";
import { useAsyncResource } from "../../hooks/use-async-resource.js";
import { desktopBackendClient } from "../../services/desktop-backend-client.js";
import { isDesktopBackendAvailable } from "../../services/desktop-backend-request.js";

type PluginDetailTab =
  | "overview"
  | "permissions"
  | "configuration"
  | "health"
  | "logs";

export function PluginDetailScreen() {
  const { pluginId = "" } = useParams();
  const decodedPluginId = decodeURIComponent(pluginId);
  const [activeTab, setActiveTab] = useState<PluginDetailTab>("overview");
  const [actionError, setActionError] = useState<string | null>(null);
  const [configurationKey, setConfigurationKey] = useState("");
  const [configurationValue, setConfigurationValue] = useState<string | null>(
    null
  );
  const [isBusy, setIsBusy] = useState(false);

  const loadDetail = useCallback(async () => {
    const [pluginResponse, runtimeResponse, reviewResponse, auditResponse] =
      await Promise.all([
        desktopBackendClient.getPlugin(decodedPluginId),
        desktopBackendClient.getPluginRuntime(decodedPluginId),
        desktopBackendClient.getPermissionReview(decodedPluginId),
        desktopBackendClient.listAuditEvents({
          pluginId: decodedPluginId,
          limit: 50
        })
      ]);

    return {
      plugin: pluginResponse.plugin,
      runtime: runtimeResponse.runtime,
      review: reviewResponse.review,
      auditEvents: auditResponse.events
    };
  }, [decodedPluginId]);

  const { data, error, isLoading, reload } = useAsyncResource(
    loadDetail,
    [decodedPluginId]
  );

  const pendingScopes = useMemo(
    () => new Set(data?.review.pendingRequirements.map((item) => item.scope)),
    [data?.review.pendingRequirements]
  );

  if (!isDesktopBackendAvailable()) {
    return <BackendUnavailableNotice />;
  }

  if (!decodedPluginId) {
    return (
      <FeatureErrorState
        title="Plugin not specified"
        description="Choose an installed plugin from the registry list."
      />
    );
  }

  if (isLoading) {
    return (
      <FeatureLoadingState
        title="Loading plugin details"
        description={`Fetching registry, runtime, and permission data for ${decodedPluginId}.`}
      />
    );
  }

  if (error || !data) {
    return (
      <FeatureErrorState
        title="Unable to load plugin"
        description={error ?? "Plugin detail request failed."}
        onRetry={reload}
      />
    );
  }

  const { plugin, runtime, review, auditEvents } = data;

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
          : "Plugin action failed."
      );
    } finally {
      setIsBusy(false);
    }
  };

  const grantPendingPermissions = async () => {
    if (review.pendingRequirements.length === 0) {
      return;
    }

    await runAction(() =>
      desktopBackendClient.grantPermissions({
        pluginId: decodedPluginId,
        grants: review.pendingRequirements.map((requirement) => ({
          scope: requirement.scope,
          decision: "always-allow" as const,
          ...(requirement.constraint
            ? { constraint: requirement.constraint }
            : {})
        }))
      })
    );
  };

  const readConfiguration = async () => {
    const key = configurationKey.trim();

    if (!key) {
      setActionError("Enter a configuration key to read from the plugin runtime.");
      return;
    }

    setIsBusy(true);
    setActionError(null);

    try {
      const response = await desktopBackendClient.readPluginConfiguration(
        decodedPluginId,
        key
      );
      setConfigurationValue(formatJson(response.configuration));
    } catch (readError) {
      setConfigurationValue(null);
      setActionError(
        readError instanceof Error
          ? readError.message
          : "Configuration read failed."
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Plugins"
        title={plugin.manifest.name}
        description={plugin.manifest.description}
        actions={
          <div className="ui-page-header__actions">
            <Link className="ui-button ui-button--ghost" to="/plugins">
              Back to plugins
            </Link>
            <Button
              disabled={isBusy}
              onClick={() =>
                void runAction(() =>
                  plugin.enabled
                    ? desktopBackendClient.disablePlugin(decodedPluginId)
                    : desktopBackendClient.enablePlugin(decodedPluginId)
                )
              }
            >
              {plugin.enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        }
      />

      {actionError ? <p className="ui-error-text">{actionError}</p> : null}

      <div className="tab-row">
        {(
          [
            ["overview", "Overview"],
            ["permissions", "Permissions"],
            ["configuration", "Configuration"],
            ["health", "Health"],
            ["logs", "Logs"]
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
          <PanelCard eyebrow="Identity" title="Plugin package">
            <div className="summary-list">
              <div className="summary-list__row">
                <span>Plugin ID</span>
                <span>{plugin.pluginId}</span>
              </div>
              <div className="summary-list__row">
                <span>Version</span>
                <span>{plugin.manifest.version}</span>
              </div>
              <div className="summary-list__row">
                <span>State</span>
                <Badge tone={plugin.enabled ? "success" : "neutral"}>
                  {plugin.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <div className="summary-list__row">
                <span>Install path</span>
                <span>{plugin.installation.rootPath}</span>
              </div>
            </div>
          </PanelCard>

          <PanelCard eyebrow="Capabilities" title="Declared manifest">
            <pre className="code-block">{formatJson(plugin.manifest)}</pre>
          </PanelCard>

          <PanelCard eyebrow="Lifecycle" title="Maintenance">
            <div className="action-row">
              <Button
                disabled={isBusy}
                onClick={() =>
                  void runAction(() =>
                    desktopBackendClient.startPluginRuntime(decodedPluginId)
                  )
                }
              >
                Start runtime
              </Button>
              <Button
                className="ui-button--ghost"
                disabled={isBusy}
                onClick={() =>
                  void runAction(() =>
                    desktopBackendClient.stopPluginRuntime(decodedPluginId)
                  )
                }
              >
                Stop runtime
              </Button>
              <Button
                className="ui-button--ghost"
                disabled={isBusy}
                onClick={() =>
                  void runAction(() =>
                    desktopBackendClient.unregisterPlugin(decodedPluginId)
                  )
                }
              >
                Unregister
              </Button>
            </div>
          </PanelCard>
        </div>
      ) : null}

      {activeTab === "permissions" ? (
        <div className="content-grid">
          <PanelCard eyebrow="Review" title="Permission review">
            <div className="summary-list">
              <div className="summary-list__row">
                <span>Can enable</span>
                <Badge tone={review.canEnable ? "success" : "warning"}>
                  {review.canEnable ? "Yes" : "Pending grants"}
                </Badge>
              </div>
              <div className="summary-list__row">
                <span>Pending requirements</span>
                <span>{review.pendingRequirements.length}</span>
              </div>
            </div>
            {review.pendingRequirements.length > 0 ? (
              <div className="action-row">
                <Button disabled={isBusy} onClick={() => void grantPendingPermissions()}>
                  Grant pending permissions
                </Button>
              </div>
            ) : null}
          </PanelCard>

          <PanelCard eyebrow="Grants" title="Active permission grants">
            {review.grants.length === 0 ? (
              <EmptyState
                title="No grants yet"
                description="Grant the pending manifest permissions before enabling the plugin."
              />
            ) : (
              <div className="stack-list">
                {review.grants.map((grant) => (
                  <div className="list-note" key={grant.id}>
                    <strong>{grant.scope}</strong>
                    <span className="ui-muted">{grant.decision}</span>
                    {!pendingScopes.has(grant.scope) ? null : (
                      <Badge tone="warning">Pending</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </PanelCard>
        </div>
      ) : null}

      {activeTab === "configuration" ? (
        <PanelCard eyebrow="Runtime" title="Read plugin configuration">
          <label className="form-field">
            <span>Configuration key</span>
            <input
              className="app-input"
              onChange={(event) => setConfigurationKey(event.target.value)}
              placeholder="settings.example"
              value={configurationKey}
            />
          </label>
          <div className="action-row">
            <Button disabled={isBusy} onClick={() => void readConfiguration()}>
              Read configuration
            </Button>
          </div>
          {configurationValue ? (
            <pre className="code-block">{configurationValue}</pre>
          ) : null}
        </PanelCard>
      ) : null}

      {activeTab === "health" ? (
        <PanelCard eyebrow="Runtime" title="Health snapshot">
          {runtime ? (
            <pre className="code-block">{formatJson(runtime)}</pre>
          ) : (
            <EmptyState
              title="Runtime not started"
              description="Start the plugin runtime to inspect process health and restart counts."
            />
          )}
        </PanelCard>
      ) : null}

      {activeTab === "logs" ? (
        <PanelCard eyebrow="Audit" title="Recent plugin events">
          {auditEvents.length === 0 ? (
            <EmptyState
              title="No audit events"
              description="Sensitive plugin operations will appear here as audit metadata."
            />
          ) : (
            <div className="stack-list">
              {auditEvents.map((event) => (
                <div className="list-note" key={event.id}>
                  <strong>{event.action}</strong>
                  <span className="ui-muted">
                    {event.outcome} · {event.timestamp}
                  </span>
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      ) : null}
    </div>
  );
}
