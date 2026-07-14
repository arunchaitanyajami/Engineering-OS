import type { ChangeEvent } from "react";

import type { ThemePreference } from "@engineering-os/config";
import { Badge, PageHeader, PanelCard } from "@engineering-os/ui";

import {
  useApplicationActions,
  useApplicationState
} from "../../stores/application-store";

const updateCheckboxSetting =
  (updateSetting: (checked: boolean) => Promise<unknown>) =>
  (event: ChangeEvent<HTMLInputElement>) => {
    void updateSetting(event.target.checked);
  };

export function SettingsScreen() {
  const { updateSettings } = useApplicationActions();
  const { appVersion, config, localServicesStatus, platformInfo } =
    useApplicationState();

  const handleThemeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    void updateSettings({
      theme: event.target.value as ThemePreference
    });
  };

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Settings"
        title="Desktop preferences"
        description="Manage local-first application behavior, appearance, and developer diagnostics."
      />

      <div className="content-grid">
        <PanelCard eyebrow="Appearance" title="Theme">
          <label className="form-field">
            <span>Theme preference</span>
            <select
              className="app-select"
              onChange={handleThemeChange}
              value={config.settings.theme}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </PanelCard>

        <PanelCard eyebrow="Application" title="Desktop behavior">
          <label className="toggle-row">
            <span>Launch on startup</span>
            <input
              checked={config.settings.launchOnStartup}
              onChange={updateCheckboxSetting((checked) =>
                updateSettings({ launchOnStartup: checked })
              )}
              type="checkbox"
            />
          </label>
          <label className="toggle-row">
            <span>Minimize to tray</span>
            <input
              checked={config.settings.minimizeToTray}
              onChange={updateCheckboxSetting((checked) =>
                updateSettings({ minimizeToTray: checked })
              )}
              type="checkbox"
            />
          </label>
          <label className="toggle-row">
            <span>Auto-update preference</span>
            <input
              checked={config.settings.autoUpdateEnabled}
              onChange={updateCheckboxSetting((checked) =>
                updateSettings({ autoUpdateEnabled: checked })
              )}
              type="checkbox"
            />
          </label>
        </PanelCard>

        <PanelCard eyebrow="Privacy" title="Local-first settings">
          <label className="toggle-row">
            <span>Telemetry enabled</span>
            <input
              checked={config.settings.telemetryEnabled}
              onChange={updateCheckboxSetting((checked) =>
                updateSettings({ telemetryEnabled: checked })
              )}
              type="checkbox"
            />
          </label>
          <p className="ui-muted">
            Engineering OS keeps Milestone 1 data local and does not configure
            cloud synchronization.
          </p>
        </PanelCard>

        <PanelCard eyebrow="Developer" title="Diagnostics">
          <label className="toggle-row">
            <span>Developer mode</span>
            <input
              checked={config.settings.developerMode}
              onChange={updateCheckboxSetting((checked) =>
                updateSettings({ developerMode: checked })
              )}
              type="checkbox"
            />
          </label>
          <div className="summary-list">
            <div className="summary-list__row">
              <span>Application version</span>
              <span>{appVersion}</span>
            </div>
            <div className="summary-list__row">
              <span>Platform</span>
              <span>
                {platformInfo?.operatingSystem ?? "unknown"} /{" "}
                {platformInfo?.arch ?? "unknown"}
              </span>
            </div>
            <div className="summary-list__row">
              <span>Log location</span>
              <span>{localServicesStatus?.logFilePath ?? "Loading"}</span>
            </div>
            <div className="summary-list__row">
              <span>Database path</span>
              <span>
                {localServicesStatus?.database.databasePath ?? "Loading"}
              </span>
            </div>
          </div>
        </PanelCard>

        <PanelCard eyebrow="Future" title="Reserved surfaces">
          <div className="stack-list">
            {[
              "AI Providers",
              "MCP Servers",
              "Plugins",
              "Knowledge Storage",
              "Security and Permissions"
            ].map((item) => (
              <div className="summary-list__row" key={item}>
                <span>{item}</span>
                <Badge tone="warning">Unavailable</Badge>
              </div>
            ))}
          </div>
        </PanelCard>
      </div>
    </div>
  );
}
