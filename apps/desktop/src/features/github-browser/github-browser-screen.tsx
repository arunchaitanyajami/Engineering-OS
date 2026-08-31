import { useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Badge, EmptyState, PageHeader, PanelCard } from "@engineering-os/ui";

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
  type GitHubPullRequest,
  type GitHubRepository
} from "../../services/desktop-backend-client.js";
import { isDesktopBackendAvailable } from "../../services/desktop-backend-request.js";

const readSearchValue = (searchParams: URLSearchParams, key: string): string =>
  searchParams.get(key)?.trim() ?? "";

export function GitHubBrowserScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedWorkspaceId = readSearchValue(searchParams, "workspaceId");
  const selectedConnectionId = readSearchValue(searchParams, "connectionId");
  const selectedOwner = readSearchValue(searchParams, "owner");
  const selectedRepository = readSearchValue(searchParams, "repository");
  const selectedPullRequestNumber = readSearchValue(
    searchParams,
    "pullRequestNumber"
  );

  const loadPage = useCallback(async () => {
    const workspacesResponse = await desktopBackendClient.listWorkspaces();

    return {
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
  const connectedConnections = (
    connectionsResource.data?.connections ?? []
  ).filter(
    (connection) =>
      connection.workspaceId === activeWorkspaceId &&
      connection.status === "connected"
  );
  const activeConnectionId = connectedConnections.some(
    (connection) => connection.id === selectedConnectionId
  )
    ? selectedConnectionId
    : (connectedConnections[0]?.id ?? "");
  const activeConnection =
    connectedConnections.find(
      (connection) => connection.id === activeConnectionId
    ) ?? null;

  const loadRepositories = useCallback(async () => {
    if (!activeWorkspaceId || !activeConnectionId) {
      return { repositories: [] as readonly GitHubRepository[] };
    }

    return desktopBackendClient.listGitHubRepositories({
      workspaceId: activeWorkspaceId,
      connectionId: activeConnectionId
    });
  }, [activeConnectionId, activeWorkspaceId]);

  const repositoriesResource = useAsyncResource(loadRepositories, [
    activeConnectionId,
    activeWorkspaceId
  ]);
  const repositories = repositoriesResource.data?.repositories ?? [];
  const activeRepository =
    repositories.find(
      (repository) =>
        repository.owner === selectedOwner &&
        repository.name === selectedRepository
    ) ?? null;

  const loadPullRequests = useCallback(async () => {
    if (!activeWorkspaceId || !activeConnectionId || !activeRepository) {
      return { pullRequests: [] as readonly GitHubPullRequest[] };
    }

    return desktopBackendClient.listGitHubPullRequests({
      workspaceId: activeWorkspaceId,
      connectionId: activeConnectionId,
      owner: activeRepository.owner,
      repository: activeRepository.name,
      state: "open"
    });
  }, [activeConnectionId, activeRepository, activeWorkspaceId]);

  const pullRequestsResource = useAsyncResource(loadPullRequests, [
    activeConnectionId,
    activeRepository?.fullName,
    activeWorkspaceId
  ]);
  const pullRequests = pullRequestsResource.data?.pullRequests ?? [];
  const selectedNumber = Number.parseInt(selectedPullRequestNumber, 10);
  const listedPullRequest = Number.isInteger(selectedNumber)
    ? (pullRequests.find(
        (pullRequest) => pullRequest.number === selectedNumber
      ) ?? null)
    : null;

  const loadSelectedPullRequest = useCallback(async () => {
    if (
      !activeWorkspaceId ||
      !activeConnectionId ||
      !activeRepository ||
      !Number.isInteger(selectedNumber) ||
      selectedNumber <= 0
    ) {
      return { pullRequest: null as GitHubPullRequest | null };
    }

    return desktopBackendClient.getGitHubPullRequest({
      workspaceId: activeWorkspaceId,
      connectionId: activeConnectionId,
      owner: activeRepository.owner,
      repository: activeRepository.name,
      pullRequestNumber: selectedNumber
    });
  }, [activeConnectionId, activeRepository, activeWorkspaceId, selectedNumber]);

  const selectedPullRequestResource = useAsyncResource(
    loadSelectedPullRequest,
    [
      activeConnectionId,
      activeRepository?.fullName,
      activeWorkspaceId,
      selectedNumber
    ]
  );
  const selectedPullRequest =
    selectedPullRequestResource.data?.pullRequest ?? listedPullRequest;

  const updateBrowseParams = (
    next: Record<string, string | undefined>
  ): void => {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(next)) {
      if (value) {
        params.set(key, value);
      }
    }

    setSearchParams(params);
  };

  if (!isDesktopBackendAvailable()) {
    return <BackendUnavailableNotice />;
  }

  if (isLoading) {
    return (
      <FeatureLoadingState
        title="Loading GitHub browser"
        description="Fetching workspaces and GitHub connections."
      />
    );
  }

  if (error || !data) {
    return (
      <FeatureErrorState
        title="Unable to load GitHub browser"
        description={error ?? "GitHub browse request failed."}
        onRetry={reload}
      />
    );
  }

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Integrations"
        title="GitHub browser"
        description="Navigate from a workspace connection to repositories and pull requests. GitHub access stays on the MCP path."
        actions={
          <Link
            className="ui-button ui-button--ghost"
            to="/integrations/github"
          >
            Manage connection
          </Link>
        }
      />

      <div className="content-grid">
        <BrowseScopeCard
          activeConnectionId={activeConnectionId}
          activeWorkspaceId={activeWorkspaceId}
          connections={connectedConnections}
          connectionsError={connectionsResource.error}
          connectionsLoading={connectionsResource.isLoading}
          onSelectConnection={(connectionId) =>
            updateBrowseParams({
              workspaceId: activeWorkspaceId,
              connectionId
            })
          }
          onSelectWorkspace={(workspaceId) =>
            updateBrowseParams({ workspaceId })
          }
          workspaces={data.workspaces}
        />

        <PanelCard eyebrow="Repositories" title="Visible repositories">
          {connectionsResource.isLoading ? (
            <p className="ui-muted">Loading connections for this workspace.</p>
          ) : !activeConnection ? (
            <EmptyState
              title="GitHub is not connected in this workspace"
              description="Connect GitHub for this workspace before browsing repositories."
              action={
                <Link className="ui-button" to="/integrations/github">
                  Open GitHub connection
                </Link>
              }
            />
          ) : repositoriesResource.isLoading ? (
            <p className="ui-muted">Loading repositories through MCP.</p>
          ) : repositoriesResource.error ? (
            <p className="ui-error-text">{repositoriesResource.error}</p>
          ) : repositories.length === 0 ? (
            <EmptyState
              title="No repositories"
              description="This connection did not return any repositories."
            />
          ) : (
            <div className="stack-list">
              {repositories.map((repository) => {
                const isSelected =
                  activeRepository?.fullName === repository.fullName;

                return (
                  <button
                    className="list-note"
                    key={repository.fullName}
                    onClick={() =>
                      updateBrowseParams({
                        workspaceId: activeWorkspaceId,
                        connectionId: activeConnectionId,
                        owner: repository.owner,
                        repository: repository.name
                      })
                    }
                    type="button"
                  >
                    <div className="list-link-card__header">
                      <strong>{repository.fullName}</strong>
                      <Badge tone={repository.private ? "warning" : "success"}>
                        {repository.private ? "Private" : "Public"}
                      </Badge>
                    </div>
                    <span className="ui-muted">
                      Default branch {repository.defaultBranch}
                    </span>
                    {repository.description ? (
                      <span className="ui-muted">{repository.description}</span>
                    ) : null}
                    {isSelected ? <Badge tone="neutral">Selected</Badge> : null}
                  </button>
                );
              })}
            </div>
          )}
        </PanelCard>

        <PanelCard eyebrow="Pull requests" title="Open pull requests">
          {!activeRepository ? (
            <EmptyState
              title="Select a repository"
              description="Choose a repository to list its open pull requests."
            />
          ) : pullRequestsResource.isLoading ? (
            <p className="ui-muted">Loading pull requests through MCP.</p>
          ) : pullRequestsResource.error ? (
            <p className="ui-error-text">{pullRequestsResource.error}</p>
          ) : pullRequests.length === 0 ? (
            <EmptyState
              title="No open pull requests"
              description={`${activeRepository.fullName} has no open pull requests.`}
            />
          ) : (
            <div className="stack-list">
              {pullRequests.map((pullRequest) => {
                const isSelected =
                  selectedPullRequest?.number === pullRequest.number;

                return (
                  <button
                    className="list-note"
                    key={pullRequest.number}
                    onClick={() =>
                      updateBrowseParams({
                        workspaceId: activeWorkspaceId,
                        connectionId: activeConnectionId,
                        owner: activeRepository.owner,
                        repository: activeRepository.name,
                        pullRequestNumber: String(pullRequest.number)
                      })
                    }
                    type="button"
                  >
                    <div className="list-link-card__header">
                      <strong>
                        #{pullRequest.number} {pullRequest.title}
                      </strong>
                      <Badge
                        tone={
                          pullRequest.state === "open" ? "success" : "neutral"
                        }
                      >
                        {pullRequest.state}
                      </Badge>
                    </div>
                    <span className="ui-muted">
                      {pullRequest.author.username} · {pullRequest.head.ref} →{" "}
                      {pullRequest.base.ref}
                    </span>
                    {isSelected ? <Badge tone="neutral">Selected</Badge> : null}
                  </button>
                );
              })}
            </div>
          )}
        </PanelCard>

        <PanelCard eyebrow="Selected PR" title="Pull request metadata">
          {!activeRepository || !Number.isInteger(selectedNumber) ? (
            <EmptyState
              title="Select a pull request"
              description="Open a pull request to inspect title, branches, and change counts. Review comes in a later phase."
            />
          ) : selectedPullRequestResource.isLoading && !selectedPullRequest ? (
            <p className="ui-muted">
              Loading pull request metadata through MCP.
            </p>
          ) : selectedPullRequestResource.error && !selectedPullRequest ? (
            <p className="ui-error-text">{selectedPullRequestResource.error}</p>
          ) : selectedPullRequest ? (
            <PullRequestMetadataCard pullRequest={selectedPullRequest} />
          ) : (
            <EmptyState
              title="Pull request not found"
              description="The selected pull request could not be loaded."
            />
          )}
        </PanelCard>
      </div>
    </div>
  );
}

function BrowseScopeCard({
  activeConnectionId,
  activeWorkspaceId,
  connections,
  connectionsError,
  connectionsLoading,
  onSelectConnection,
  onSelectWorkspace,
  workspaces
}: {
  readonly activeConnectionId: string;
  readonly activeWorkspaceId: string;
  readonly connections: readonly GitHubConnectionRecord[];
  readonly connectionsError: string | null;
  readonly connectionsLoading: boolean;
  readonly onSelectConnection: (connectionId: string) => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly workspaces: readonly EngineeringWorkspace[];
}) {
  return (
    <PanelCard eyebrow="Scope" title="Workspace connection">
      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          description="Create a workspace and connect GitHub before browsing repositories."
          action={
            <Link className="ui-button" to="/integrations/github">
              Open GitHub connection
            </Link>
          }
        />
      ) : (
        <>
          <label className="form-field" htmlFor="github-browse-workspace">
            <span>Workspace</span>
            <select
              className="app-select"
              id="github-browse-workspace"
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
          {connectionsLoading ? (
            <p className="ui-muted">Loading connections for this workspace.</p>
          ) : connectionsError ? (
            <p className="ui-error-text">{connectionsError}</p>
          ) : connections.length === 0 ? (
            <EmptyState
              title="No connected GitHub account"
              description="This workspace has no connected GitHub account. Other workspaces stay isolated."
            />
          ) : (
            <label className="form-field" htmlFor="github-browse-connection">
              <span>Connection</span>
              <select
                className="app-select"
                id="github-browse-connection"
                onChange={(event) => onSelectConnection(event.target.value)}
                value={activeConnectionId}
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.displayName}
                    {connection.accountLogin
                      ? ` (${connection.accountLogin})`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </PanelCard>
  );
}

function PullRequestMetadataCard({
  pullRequest
}: {
  readonly pullRequest: GitHubPullRequest;
}) {
  return (
    <div className="summary-list">
      <div className="summary-list__row">
        <span>Title</span>
        <span>{pullRequest.title}</span>
      </div>
      <div className="summary-list__row">
        <span>Repository</span>
        <span>
          {pullRequest.repository.owner}/{pullRequest.repository.name}
        </span>
      </div>
      <div className="summary-list__row">
        <span>Number</span>
        <span>#{pullRequest.number}</span>
      </div>
      <div className="summary-list__row">
        <span>State</span>
        <Badge tone={pullRequest.state === "open" ? "success" : "neutral"}>
          {pullRequest.state}
        </Badge>
      </div>
      <div className="summary-list__row">
        <span>Author</span>
        <span>{pullRequest.author.username}</span>
      </div>
      <div className="summary-list__row">
        <span>Base</span>
        <span>
          {pullRequest.base.ref} ({pullRequest.base.sha.slice(0, 7)})
        </span>
      </div>
      <div className="summary-list__row">
        <span>Head</span>
        <span>
          {pullRequest.head.ref} ({pullRequest.head.sha.slice(0, 7)})
        </span>
      </div>
      <div className="summary-list__row">
        <span>Changes</span>
        <span>
          +{pullRequest.additions} / -{pullRequest.deletions} ·{" "}
          {pullRequest.changedFiles} files
        </span>
      </div>
      <div className="summary-list__row">
        <span>Updated</span>
        <span>{pullRequest.updatedAt}</span>
      </div>
      <div className="summary-list__row">
        <span>GitHub</span>
        <a href={pullRequest.url} rel="noreferrer" target="_blank">
          Open on GitHub
        </a>
      </div>
    </div>
  );
}
