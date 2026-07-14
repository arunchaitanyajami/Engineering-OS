import { Link, useNavigate } from "react-router-dom";

import { Badge, Button, EmptyState, PageHeader, PanelCard } from "@engineering-os/ui";

import { useApplicationActions, useApplicationState } from "../../stores/application-store";

export function HomeScreen() {
  const navigate = useNavigate();
  const { createSession } = useApplicationActions();
  const { sessions, platformInfo } = useApplicationState();

  const handleCreateSession = () => {
    const session = createSession();
    void navigate(`/sessions/${session.id}`);
  };

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Workspace"
        title="Engineering OS"
        description="Desktop-first engineering workspace foundation for sessions, plugins, workflows, and MCP integrations."
        actions={<Button onClick={handleCreateSession}>New Session</Button>}
      />

      <div className="content-grid">
        <PanelCard eyebrow="Launch" title="Start a new engineering session">
          <p className="ui-muted">
            Milestone 1 establishes the session shell without connecting an AI
            provider yet.
          </p>
          <div className="action-row">
            <Button onClick={handleCreateSession}>Create Session Shell</Button>
          </div>
        </PanelCard>

        <PanelCard eyebrow="Status" title="Platform status">
          <div className="summary-list">
            <div className="summary-list__row">
              <span>Desktop runtime</span>
              <Badge tone="success">Ready</Badge>
            </div>
            <div className="summary-list__row">
              <span>Platform</span>
              <span>{platformInfo?.operatingSystem ?? "Loading"}</span>
            </div>
            <div className="summary-list__row">
              <span>Plugins</span>
              <span>Not configured</span>
            </div>
            <div className="summary-list__row">
              <span>Workflows</span>
              <span>Not configured</span>
            </div>
            <div className="summary-list__row">
              <span>Knowledge index</span>
              <span>Not configured</span>
            </div>
          </div>
        </PanelCard>

        <PanelCard eyebrow="Sessions" title="Recent sessions">
          {sessions.length > 0 ? (
            <div className="stack-list">
              {sessions.slice(0, 5).map((session) => (
                <Link
                  className="list-link-card"
                  key={session.id}
                  to={`/sessions/${session.id}`}
                >
                  <strong>{session.title}</strong>
                  <span className="ui-muted">{session.updatedAt}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No sessions yet"
              description="Create your first local session shell to validate the desktop workspace layout."
            />
          )}
        </PanelCard>

        <PanelCard eyebrow="Foundation" title="Milestone boundaries">
          <div className="stack-list">
            <div className="list-note">
              <strong>Plugin summaries</strong>
              <span className="ui-muted">
                Plugin SDK and installation arrive in Milestone 2.
              </span>
            </div>
            <div className="list-note">
              <strong>Workflow summaries</strong>
              <span className="ui-muted">
                Workflow execution is intentionally deferred.
              </span>
            </div>
            <div className="list-note">
              <strong>Knowledge summaries</strong>
              <span className="ui-muted">
                Knowledge indexing remains unavailable in this milestone.
              </span>
            </div>
          </div>
        </PanelCard>
      </div>
    </div>
  );
}
