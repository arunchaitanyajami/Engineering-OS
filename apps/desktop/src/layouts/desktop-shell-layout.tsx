import { useEffect, useMemo } from "react";
import { Outlet, matchPath, useLocation, useNavigate } from "react-router-dom";

import {
  Badge,
  Button,
  SidebarItem,
  SidebarNavigation,
  StatusIndicator
} from "@engineering-os/ui";

import { CommandPalette } from "../components/command-palette";
import { appRouteDefinitions } from "../routes/route-definitions";
import {
  ApplicationCommandRegistry,
  shouldHandleGlobalShortcut
} from "../services/command-registry";
import {
  buildStatusEntries,
  useApplicationActions,
  useApplicationState
} from "../stores/application-store";

const getCurrentRoute = (pathname: string) =>
  appRouteDefinitions.find((routeDefinition) =>
    matchPath(
      { path: routeDefinition.path, end: routeDefinition.id !== "sessions" },
      pathname
    )
  );

const platformShortcutLabel = (shortcut: string): string =>
  navigator.platform.toLowerCase().includes("mac")
    ? shortcut.replace("Ctrl", "Cmd")
    : shortcut;

const nextThemePreference = (
  currentPreference: "system" | "light" | "dark",
  resolvedTheme: "light" | "dark"
): "light" | "dark" => {
  if (currentPreference === "system") {
    return resolvedTheme === "dark" ? "light" : "dark";
  }

  return currentPreference === "dark" ? "light" : "dark";
};

export function DesktopShellLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { createSession, setCommandPaletteOpen, updateSettings } =
    useApplicationActions();
  const state = useApplicationState();
  const currentRoute =
    getCurrentRoute(location.pathname) ??
    appRouteDefinitions.find(
      (routeDefinition) => routeDefinition.id === "home"
    );

  const commandRegistry = useMemo(() => {
    const registry = new ApplicationCommandRegistry();

    registry.registerMany([
      {
        id: "navigate.home",
        title: "Navigate to Home",
        category: "Navigation",
        keywords: ["home", "dashboard"],
        shortcut: platformShortcutLabel("Ctrl+H"),
        execute: () => navigate("/home")
      },
      {
        id: "navigate.sessions",
        title: "Open Sessions",
        category: "Navigation",
        keywords: ["sessions", "history"],
        execute: () => navigate("/sessions")
      },
      {
        id: "navigate.settings",
        title: "Open Settings",
        category: "Navigation",
        keywords: ["settings", "preferences"],
        shortcut: platformShortcutLabel("Ctrl+,"),
        execute: () => navigate("/settings")
      },
      {
        id: "session.create",
        title: "Create New Session",
        category: "Workspace",
        keywords: ["new", "session", "workspace"],
        shortcut: platformShortcutLabel("Ctrl+N"),
        execute: () =>
          createSession().then((session) => {
            navigate(`/sessions/${session.id}`);
          })
      },
      {
        id: "theme.toggle",
        title: "Toggle Theme",
        category: "Appearance",
        keywords: ["theme", "light", "dark", "appearance"],
        execute: () =>
          updateSettings({
            theme: nextThemePreference(
              state.config.settings.theme,
              state.resolvedTheme
            )
          }).then(() => undefined)
      },
      {
        id: "application.reload",
        title: "Reload Application",
        category: "Application",
        keywords: ["reload", "restart"],
        execute: () => window.location.reload()
      },
      ...(import.meta.env.DEV
        ? [
            {
              id: "developer.open-tools",
              title: "Open Developer Tools",
              category: "Developer",
              keywords: ["developer", "devtools", "debug"],
              shortcut: platformShortcutLabel("Ctrl+Shift+I"),
              execute: () => {
                console.info(
                  "Developer tools are available through the desktop runtime in development mode."
                );
              }
            }
          ]
        : [])
    ]);

    return registry;
  }, [
    createSession,
    navigate,
    state.config.settings.theme,
    state.resolvedTheme,
    updateSettings
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleGlobalShortcut(event.target)) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && (event.key.toLowerCase() === "k" || event.shiftKey)) {
        if (
          event.key.toLowerCase() === "k" ||
          (event.shiftKey && event.key.toLowerCase() === "p")
        ) {
          event.preventDefault();
          setCommandPaletteOpen(true);
        }
      }

      if (modifier && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void commandRegistry.execute("session.create");
      }

      if (modifier && event.key === ",") {
        event.preventDefault();
        void commandRegistry.execute("navigate.settings");
      }

      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [commandRegistry, setCommandPaletteOpen]);

  const statusEntries = buildStatusEntries(state);

  return (
    <div className="desktop-shell">
      <aside className="desktop-shell__sidebar">
        <div className="sidebar-brand">
          <p className="ui-eyebrow">Engineering OS</p>
          <h1>Desktop Shell</h1>
          <p className="ui-muted">
            Milestone 1 establishes the desktop foundation for future platform
            capabilities.
          </p>
        </div>

        <SidebarNavigation
          items={appRouteDefinitions.filter(
            (routeDefinition) => routeDefinition.enabled
          )}
          renderItem={(routeDefinition) => (
            <SidebarItem
              active={Boolean(
                matchPath(
                  {
                    path: routeDefinition.path,
                    end: routeDefinition.id !== "sessions"
                  },
                  location.pathname
                )
              )}
              icon={<routeDefinition.icon />}
              key={routeDefinition.id}
              label={routeDefinition.title}
              onClick={() => void navigate(routeDefinition.path)}
              suffix={
                routeDefinition.id === "settings" ? (
                  <Badge tone="neutral">System</Badge>
                ) : undefined
              }
            />
          )}
        />
      </aside>

      <div className="desktop-shell__main">
        <header className="desktop-header">
          <div className="desktop-header__group">
            <Button className="ui-button--ghost" onClick={() => navigate(-1)}>
              Back
            </Button>
            <Button className="ui-button--ghost" onClick={() => navigate(1)}>
              Forward
            </Button>
          </div>

          <div className="desktop-header__title">
            <strong>{currentRoute?.title ?? "Engineering OS"}</strong>
            <span className="ui-muted">
              {currentRoute?.description ?? "Desktop workspace"}
            </span>
          </div>

          <div className="desktop-header__group">
            <Badge
              tone={
                state.initializationState.status === "ready"
                  ? "success"
                  : state.initializationState.status === "failed"
                    ? "error"
                    : "warning"
              }
            >
              {state.initializationState.status}
            </Badge>
            <Button
              className="ui-button--ghost"
              onClick={() => setCommandPaletteOpen(true)}
            >
              Command Palette
            </Button>
            <Button className="ui-button--ghost" disabled>
              Workspace Selector
            </Button>
          </div>
        </header>

        <main className="desktop-workspace">
          <Outlet />
        </main>

        <footer className="desktop-status-bar">
          {statusEntries.map((entry) => (
            <StatusIndicator
              key={entry.id}
              label={entry.label}
              tone={entry.tone}
              value={entry.value}
            />
          ))}
        </footer>
      </div>

      <CommandPalette
        isOpen={state.isCommandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        registry={commandRegistry}
      />
    </div>
  );
}
