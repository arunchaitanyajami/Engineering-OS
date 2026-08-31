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

import { GitHubBrowserScreen } from "../src/features/github-browser/github-browser-screen";
import type {
  EngineeringWorkspace,
  GitHubConnectionRecord,
  GitHubPullRequest,
  GitHubRepository
} from "../src/services/desktop-backend-client";

const listWorkspaces = vi.fn();
const listGitHubConnections = vi.fn();
const listGitHubRepositories = vi.fn();
const listGitHubPullRequests = vi.fn();
const getGitHubPullRequest = vi.fn();
const executeMcpTool = vi.fn();

vi.mock("../src/services/desktop-backend-request.js", () => ({
  isDesktopBackendAvailable: () => true
}));

vi.mock("../src/services/desktop-backend-client.js", () => ({
  desktopBackendClient: {
    listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
    listGitHubConnections: (...args: unknown[]) =>
      listGitHubConnections(...args),
    listGitHubRepositories: (...args: unknown[]) =>
      listGitHubRepositories(...args),
    listGitHubPullRequests: (...args: unknown[]) =>
      listGitHubPullRequests(...args),
    getGitHubPullRequest: (...args: unknown[]) => getGitHubPullRequest(...args),
    executeMcpTool: (...args: unknown[]) => executeMcpTool(...args)
  }
}));

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

const sampleRepository: GitHubRepository = {
  provider: "github",
  owner: "acme",
  name: "widgets",
  fullName: "acme/widgets",
  defaultBranch: "main",
  private: true,
  url: "https://github.com/acme/widgets",
  description: "Internal widgets"
};

const samplePullRequest: GitHubPullRequest = {
  provider: "github",
  repository: {
    owner: "acme",
    name: "widgets"
  },
  number: 12,
  title: "Harden authentication",
  description: "Reject expired tokens.",
  state: "open",
  author: {
    id: "42",
    username: "ada"
  },
  base: {
    ref: "main",
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  head: {
    ref: "fix-auth",
    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  createdAt: "2026-08-31T08:00:00.000Z",
  updatedAt: "2026-08-31T09:00:00.000Z",
  url: "https://github.com/acme/widgets/pull/12"
};

describe("GitHub browser UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    listWorkspaces.mockResolvedValue({
      workspaces: [companyWorkspace, personalWorkspace]
    });
    listGitHubConnections.mockImplementation(async (workspaceId: string) => ({
      connections: workspaceId === "workspace-a" ? [companyConnection] : []
    }));
    listGitHubRepositories.mockResolvedValue({
      repositories: [sampleRepository]
    });
    listGitHubPullRequests.mockResolvedValue({
      pullRequests: [samplePullRequest]
    });
    getGitHubPullRequest.mockResolvedValue({
      pullRequest: samplePullRequest
    });
  });

  it("navigates connection to repository to pull request through backend browse APIs", async () => {
    render(
      <MemoryRouter initialEntries={["/integrations/github/browse"]}>
        <GitHubBrowserScreen />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole("heading", { name: "GitHub browser" })
    ).toBeInTheDocument();
    expect(await screen.findByText("acme/widgets")).toBeInTheDocument();
    expect(listGitHubRepositories).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      connectionId: "connection-1"
    });
    expect(executeMcpTool).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /acme\/widgets/i }));

    expect(
      await screen.findByText("#12 Harden authentication")
    ).toBeInTheDocument();
    expect(listGitHubPullRequests).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      connectionId: "connection-1",
      owner: "acme",
      repository: "widgets",
      state: "open"
    });

    fireEvent.click(
      screen.getByRole("button", { name: /#12 Harden authentication/i })
    );

    expect(
      await screen.findByText("Harden authentication")
    ).toBeInTheDocument();
    expect(await screen.findByText("+10 / -2 · 1 files")).toBeInTheDocument();
    await waitFor(() => {
      expect(getGitHubPullRequest).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        connectionId: "connection-1",
        owner: "acme",
        repository: "widgets",
        pullRequestNumber: 12
      });
    });
    expect(executeMcpTool).not.toHaveBeenCalled();
  });

  it("does not browse another workspace connection", async () => {
    render(
      <MemoryRouter initialEntries={["/integrations/github/browse"]}>
        <GitHubBrowserScreen />
      </MemoryRouter>
    );

    expect(await screen.findByText("acme/widgets")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Company A GitHub/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Workspace"), {
      target: { value: "workspace-b" }
    });

    expect(
      await screen.findByText("No connected GitHub account")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Company A GitHub/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("acme/widgets")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(listGitHubConnections).toHaveBeenCalledWith("workspace-b");
    });
    expect(
      listGitHubRepositories.mock.calls.some(
        (call) =>
          call[0]?.workspaceId === "workspace-b" &&
          call[0]?.connectionId === "connection-1"
      )
    ).toBe(false);
  });
});
