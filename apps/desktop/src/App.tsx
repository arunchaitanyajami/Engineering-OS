import {
  PanelCard,
  SidebarNavigation,
  type NavigationItem
} from "@engineering-os/ui";

const navigationItems: readonly NavigationItem[] = [
  { id: "plugins", label: "Plugins" },
  { id: "agents", label: "Agents" },
  { id: "workflows", label: "Workflows" },
  { id: "memory", label: "Memory" },
  { id: "settings", label: "Settings" }
];

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Engineering OS</p>
          <h1>Desktop Shell</h1>
          <p className="muted">
            Milestone 0 establishes the workspace, architecture, and app
            surface.
          </p>
        </div>

        <SidebarNavigation items={navigationItems} />
      </aside>

      <main className="workspace">
        <PanelCard eyebrow="Workspace" title="AI-native engineering platform">
          <p className="muted">
            The first MVP flow will connect GitHub and run a structured PR
            review workflow from the desktop application.
          </p>
        </PanelCard>

        <PanelCard eyebrow="Chat" title="Desktop shell readiness">
          <div className="message">
            <strong>System</strong>
            <p>
              Welcome to Engineering OS. Milestone 0 now validates the monorepo,
              contracts, configuration, logging, database migrations, and test
              infrastructure.
            </p>
          </div>

          <label className="composer">
            <span className="composer-label">Ask a question</span>
            <textarea
              placeholder="Example: Review PR 123"
              rows={5}
              aria-label="Chat input"
            />
          </label>
        </PanelCard>
      </main>
    </div>
  );
}
