import type { ComponentType } from "react";

const createLetterIcon = (letter: string): ComponentType =>
  function LetterIcon() {
    return (
      <span aria-hidden="true" className="route-icon">
        {letter}
      </span>
    );
  };

export interface AppRouteDefinition {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly icon: ComponentType;
  readonly navigationGroup?: "primary" | "platform" | "system";
  readonly enabled: boolean;
}

export const appRouteDefinitions: readonly AppRouteDefinition[] = [
  {
    id: "home",
    path: "/home",
    label: "Home",
    title: "Home",
    description: "Launch new engineering sessions and review desktop status.",
    icon: createLetterIcon("H"),
    navigationGroup: "primary",
    enabled: true
  },
  {
    id: "new-session",
    path: "/sessions/new",
    label: "New Session",
    title: "New Session",
    description: "Create a new local engineering workspace shell.",
    icon: createLetterIcon("N"),
    navigationGroup: "primary",
    enabled: true
  },
  {
    id: "sessions",
    path: "/sessions",
    label: "Sessions",
    title: "Sessions",
    description: "View and reopen local engineering sessions.",
    icon: createLetterIcon("S"),
    navigationGroup: "primary",
    enabled: true
  },
  {
    id: "agents",
    path: "/agents",
    label: "Agents",
    title: "Agents",
    description: "Available in a future milestone.",
    icon: createLetterIcon("A"),
    navigationGroup: "platform",
    enabled: true
  },
  {
    id: "plugins",
    path: "/plugins",
    label: "Plugins",
    title: "Plugins",
    description: "Available in a future milestone.",
    icon: createLetterIcon("P"),
    navigationGroup: "platform",
    enabled: true
  },
  {
    id: "workflows",
    path: "/workflows",
    label: "Workflows",
    title: "Workflows",
    description: "Available in a future milestone.",
    icon: createLetterIcon("W"),
    navigationGroup: "platform",
    enabled: true
  },
  {
    id: "knowledge",
    path: "/knowledge",
    label: "Knowledge",
    title: "Knowledge",
    description: "Available in a future milestone.",
    icon: createLetterIcon("K"),
    navigationGroup: "platform",
    enabled: true
  },
  {
    id: "settings",
    path: "/settings",
    label: "Settings",
    title: "Settings",
    description: "Manage local desktop preferences and developer options.",
    icon: createLetterIcon("T"),
    navigationGroup: "system",
    enabled: true
  }
];
