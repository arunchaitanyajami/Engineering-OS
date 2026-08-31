import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { GitHubConnectionScreen } from "../src/features/github-connection/github-connection-screen";
import type {
  EngineeringWorkspace,
  GitHubConnectionRecord,
  InstalledPlugin
} from "../src/services/desktop-backend-client";

const listPlugins = vi.fn();
const listWorkspaces = vi.fn();
const getPermissionReview = vi.fn();
const listGitHubConnections = vi.fn();
const createWorkspace = vi.fn();
const createGitHubConnection = vi.fn();
const disconnectGitHubConnection = vi.fn();
const enablePlugin = vi.fn();
const grantPermissions = vi.fn();

vi.mock("../src/services/desktop-backend-request.js", () => ({
  isDesktopBackendAvailable: () => true
}));

vi.mock("../src/services/desktop-backend-client.js", () => ({
  desktopBackendClient: {
    listPlugins: (...args: unknown[]) => listPlugins(...args),
    listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
    getPermissionReview: (...args: unknown[]) => getPermissionReview(...args),
    listGitHubConnections: (...args: unknown[]) =>
      listGitHubConnections(...args),
    createWorkspace: (...args: unknown[]) => createWorkspace(...args),
    createGitHubConnection: (...args: unknown[]) =>
      createGitHubConnection(...args),
    disconnectGitHubConnection: (...args: unknown[]) =>
      disconnectGitHubConnection(...args),
    enablePlugin: (...args: unknown[]) => enablePlugin(...args),
    grantPermissions: (...args: unknown[]) => grantPermissions(...args)
  }
}));

const githubPlugin: InstalledPlugin = {
  id: "registration-github",
  pluginId: "com.engineering-os.github",
  manifest: {
    schemaVersion: "1",
    id: "com.engineering-os.github",
    name: "GitHub",
    version: "0.1.0",
    description: "Connect a GitHub account.",
    publisher: { name: "Engineering OS" },
    engines: { engineeringOs: ">=0.2.0" },
    entrypoints: { backend: "./dist/backend/index.js" },
    capabilities: ["mcp-server", "settings"],
    permissions: [
      {
        scope: "network.access",
        hosts: ["api.github.com"],
        reason: "Reads GitHub repositories."
      },
      {
        scope: "secrets.read",
        reason: "Resolves GitHub credential references."
      }
    ],
    mcp: []
  },
  installation: {
    mode: "development-link",
    rootPath: "/plugins/github",
    contentHash: "abc",
    source: { type: "local-directory", path: "/plugins/github" }
  },
  state: "installed",
  enabled: false,
  installedAt: "2026-08-31T08:00:00.000Z",
  updatedAt: "2026-08-31T08:00:00.000Z",
  lastError: null
};

const companyWorkspace: EngineeringWorkspace = {
  id: "workspace-a",
  name: "Company A",
  createdAt: "2026-08-31T08:00:00.000Z",
  updatedAt: "2026-08-31T08:00:00.000Z"
};

const personalWorkspace: EngineeringWorkspace = {
  id: "workspace-b",
  name: "Personal",
  createdAt: "2026-08-31T08:00:00.000Z",
  updatedAt: "2026-08-31T08:00:00.000Z"
};

const companyConnection: GitHubConnectionRecord = {
  id: "connection-1",
  workspaceId: "workspace-a",
  pluginId: "com.engineering-os.github",
  displayName: "Company A GitHub",
  credentialRef: "workspace.workspace-a.connection.connection-1.pat",
  status: "connected",
  createdAt: "2026-08-31T08:00:00.000Z",
  updatedAt: "2026-08-31T08:00:00.000Z",
  accountLogin: "ada",
  lastError: null,
  authMethodType: "personal-access-token"
};

describe("GitHub connection UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    listPlugins.mockResolvedValue({ plugins: [githubPlugin] });
    listWorkspaces.mockResolvedValue({
      workspaces: [companyWorkspace, personalWorkspace]
    });
    getPermissionReview.mockResolvedValue({
      review: {
        pluginId: githubPlugin.pluginId,
        requirements: githubPlugin.manifest.permissions,
        grants: [],
        pendingRequirements: githubPlugin.manifest.permissions,
        canEnable: false,
        upgradeReviewRequired: false
      }
    });
    listGitHubConnections.mockImplementation(async (workspaceId: string) => ({
      connections: workspaceId === "workspace-a" ? [companyConnection] : []
    }));
  });

  it("shows plugin permissions and isolates connections by workspace", async () => {
    render(
      <MemoryRouter>
        <GitHubConnectionScreen />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: "GitHub" })
    ).toBeInTheDocument();
    expect(screen.getByText("network.access")).toBeInTheDocument();
    expect(screen.getByText("secrets.read")).toBeInTheDocument();
    expect(await screen.findByText("Company A GitHub")).toBeInTheDocument();
    expect(screen.getByText("Authenticated as ada")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Active workspace"), {
      target: { value: "workspace-b" }
    });

    await waitFor(() => {
      expect(listGitHubConnections).toHaveBeenCalledWith("workspace-b");
    });
    expect(await screen.findByText("No GitHub connection")).toBeInTheDocument();
    expect(screen.queryByText("Company A GitHub")).not.toBeInTheDocument();
  });

  it("enables the GitHub plugin after granting permissions", async () => {
    grantPermissions.mockResolvedValue({
      review: {
        pluginId: githubPlugin.pluginId,
        requirements: githubPlugin.manifest.permissions,
        grants: githubPlugin.manifest.permissions,
        pendingRequirements: [],
        canEnable: true,
        upgradeReviewRequired: false
      }
    });
    enablePlugin.mockResolvedValue({
      plugin: { ...githubPlugin, enabled: true }
    });

    render(
      <MemoryRouter>
        <GitHubConnectionScreen />
      </MemoryRouter>
    );

    await screen.findByRole("heading", { name: "GitHub" });
    fireEvent.click(
      screen.getByRole("button", { name: "Grant pending permissions" })
    );

    await waitFor(() => {
      expect(grantPermissions).toHaveBeenCalled();
    });
  });
});
