import { useCallback, useState } from "react";
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
  type InstalledPlugin
} from "../../services/desktop-backend-client.js";
import { isDesktopBackendAvailable } from "../../services/desktop-backend-request.js";
import { pickPluginDirectory } from "../../services/plugin-directory-picker.js";

const pluginStateTone = (
  plugin: InstalledPlugin
): "success" | "warning" | "error" | "neutral" => {
  if (plugin.state === "incompatible") {
    return "error";
  }

  if (plugin.enabled) {
    return "success";
  }

  return "neutral";
};

const pluginStateLabel = (plugin: InstalledPlugin): string => {
  if (plugin.state === "incompatible") {
    return "Incompatible";
  }

  return plugin.enabled ? "Enabled" : "Disabled";
};

export function PluginsScreen() {
  const [packagePath, setPackagePath] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isPickingDirectory, setIsPickingDirectory] = useState(false);

  const loadPlugins = useCallback(() => desktopBackendClient.listPlugins(), []);
  const { data, error, isLoading, reload } = useAsyncResource(loadPlugins, []);

  if (!isDesktopBackendAvailable()) {
    return <BackendUnavailableNotice />;
  }

  if (isLoading) {
    return (
      <FeatureLoadingState
        title="Loading plugins"
        description="Fetching installed plugin packages from the local registry."
      />
    );
  }

  if (error || !data) {
    return (
      <FeatureErrorState
        title="Unable to load plugins"
        description={error ?? "Plugin registry request failed."}
        onRetry={reload}
      />
    );
  }

  const handleBrowse = async () => {
    setIsPickingDirectory(true);
    setActionError(null);

    try {
      const selectedPath = await pickPluginDirectory();

      if (selectedPath) {
        setPackagePath(selectedPath);
      }
    } catch (browseError) {
      setActionError(
        browseError instanceof Error
          ? browseError.message
          : "Unable to open the directory picker."
      );
    } finally {
      setIsPickingDirectory(false);
    }
  };

  const handleRegister = async () => {
    const trimmedPath = packagePath.trim();

    if (!trimmedPath) {
      setActionError("Enter the absolute path to a local plugin package.");
      return;
    }

    setIsRegistering(true);
    setActionError(null);

    try {
      await desktopBackendClient.registerLocalPlugin(trimmedPath);
      setPackagePath("");
      reload();
    } catch (registerError) {
      setActionError(
        registerError instanceof Error
          ? registerError.message
          : "Plugin registration failed."
      );
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Settings"
        title="Plugins"
        description="Install, inspect, and manage local plugin packages with permissions and runtime health."
      />

      <div className="content-grid">
        <PanelCard eyebrow="Install" title="Register local package">
          <label className="form-field">
            <span>Package directory path</span>
            <div className="path-input-row">
              <input
                className="app-input"
                onChange={(event) => setPackagePath(event.target.value)}
                placeholder="/absolute/path/to/plugin-package"
                value={packagePath}
              />
              <Button
                className="ui-button--ghost"
                disabled={isPickingDirectory || isRegistering}
                onClick={() => void handleBrowse()}
                type="button"
              >
                {isPickingDirectory ? "Opening…" : "Browse…"}
              </Button>
            </div>
          </label>
          <p className="ui-muted">
            Choose a folder containing <code>engineering-os.plugin.json</code>,
            or paste an absolute path manually.
          </p>
          {actionError ? <p className="ui-error-text">{actionError}</p> : null}
          <div className="action-row">
            <Button
              disabled={isRegistering}
              onClick={() => void handleRegister()}
            >
              {isRegistering ? "Registering…" : "Register local package"}
            </Button>
          </div>
        </PanelCard>

        <PanelCard eyebrow="Installed" title="Registered plugins">
          {data.plugins.length === 0 ? (
            <EmptyState
              title="No plugins installed"
              description="Register a local plugin package to begin Milestone 2 validation."
            />
          ) : (
            <div className="stack-list">
              {data.plugins.map((plugin) => (
                <Link
                  className="list-link-card"
                  key={plugin.id}
                  to={`/plugins/${encodeURIComponent(plugin.pluginId)}`}
                >
                  <div className="list-link-card__header">
                    <strong>{plugin.manifest.name}</strong>
                    <Badge tone={pluginStateTone(plugin)}>
                      {pluginStateLabel(plugin)}
                    </Badge>
                  </div>
                  <span className="ui-muted">{plugin.pluginId}</span>
                  <span className="ui-muted">
                    v{plugin.manifest.version} · {plugin.installation.mode}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </PanelCard>
      </div>
    </div>
  );
}
