import { useCallback } from "react";
import { Link } from "react-router-dom";

import { Badge, EmptyState, PageHeader, PanelCard } from "@engineering-os/ui";

import {
  BackendUnavailableNotice,
  FeatureErrorState,
  FeatureLoadingState
} from "../shared/feature-states.js";
import { useAsyncResource } from "../../hooks/use-async-resource.js";
import { desktopBackendClient } from "../../services/desktop-backend-client.js";
import { isDesktopBackendAvailable } from "../../services/desktop-backend-request.js";

interface PluginPermissionSummary {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly enabled: boolean;
  readonly pendingCount: number;
  readonly grantCount: number;
  readonly canEnable: boolean;
}

const loadPermissionSummaries = async (): Promise<
  readonly PluginPermissionSummary[]
> => {
  const { plugins } = await desktopBackendClient.listPlugins();

  return Promise.all(
    plugins.map(async (plugin) => {
      const { review } = await desktopBackendClient.getPermissionReview(
        plugin.pluginId
      );

      return {
        pluginId: plugin.pluginId,
        pluginName: plugin.manifest.name,
        enabled: plugin.enabled,
        pendingCount: review.pendingRequirements.length,
        grantCount: review.grants.length,
        canEnable: review.canEnable
      };
    })
  );
};

export function PermissionsScreen() {
  const loadSummaries = useCallback(loadPermissionSummaries, []);
  const { data, error, isLoading, reload } = useAsyncResource(loadSummaries, []);

  if (!isDesktopBackendAvailable()) {
    return <BackendUnavailableNotice />;
  }

  if (isLoading) {
    return (
      <FeatureLoadingState
        title="Loading permissions"
        description="Reviewing plugin permission grants across the local registry."
      />
    );
  }

  if (error || !data) {
    return (
      <FeatureErrorState
        title="Unable to load permissions"
        description={error ?? "Permission review request failed."}
        onRetry={reload}
      />
    );
  }

  const pendingTotal = data.reduce(
    (total, summary) => total + summary.pendingCount,
    0
  );

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Permissions"
        title="Plugin permission review"
        description="Inspect capability grants across installed plugins before enabling runtime access."
      />

      <div className="content-grid">
        <PanelCard eyebrow="Summary" title="Registry posture">
          <div className="summary-list">
            <div className="summary-list__row">
              <span>Installed plugins</span>
              <span>{data.length}</span>
            </div>
            <div className="summary-list__row">
              <span>Pending requirements</span>
              <Badge tone={pendingTotal > 0 ? "warning" : "success"}>
                {pendingTotal}
              </Badge>
            </div>
          </div>
        </PanelCard>

        <PanelCard eyebrow="Plugins" title="Permission status">
          {data.length === 0 ? (
            <EmptyState
              title="No plugins installed"
              description="Install a reference plugin from the Plugins screen to review its requested permissions."
              action={
                <Link className="ui-button" to="/plugins">
                  Open plugins
                </Link>
              }
            />
          ) : (
            <div className="stack-list">
              {data.map((summary) => (
                <div className="summary-list__row" key={summary.pluginId}>
                  <div className="stack-list">
                    <span>{summary.pluginName}</span>
                    <span className="ui-muted">{summary.pluginId}</span>
                  </div>
                  <div className="action-row">
                    <Badge tone={summary.pendingCount > 0 ? "warning" : "success"}>
                      {summary.pendingCount > 0
                        ? `${summary.pendingCount} pending`
                        : "Granted"}
                    </Badge>
                    <Badge tone={summary.canEnable ? "success" : "neutral"}>
                      {summary.canEnable ? "Enable ready" : "Blocked"}
                    </Badge>
                    <Link
                      className="ui-button ui-button--ghost"
                      to={`/plugins/${encodeURIComponent(summary.pluginId)}`}
                    >
                      Review
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelCard>
      </div>
    </div>
  );
}
