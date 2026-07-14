import { Link, useNavigate } from "react-router-dom";

import { Button, EmptyState, PageHeader } from "@engineering-os/ui";

import { useApplicationActions, useApplicationState } from "../../stores/application-store";

export function SessionsScreen() {
  const navigate = useNavigate();
  const { createSession } = useApplicationActions();
  const { sessions } = useApplicationState();

  const handleCreateSession = () => {
    const session = createSession();
    void navigate(`/sessions/${session.id}`);
  };

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Sessions"
        title="Local session shells"
        description="Sessions establish the future workspace model without introducing fake AI behavior."
        actions={<Button onClick={handleCreateSession}>New Session</Button>}
      />

      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions created"
          description="Create a session to validate the chat workspace layout and future persistence model."
          action={<Button onClick={handleCreateSession}>Create Session</Button>}
        />
      ) : (
        <div className="stack-list">
          {sessions.map((session) => (
            <Link className="list-link-card" key={session.id} to={`/sessions/${session.id}`}>
              <strong>{session.title}</strong>
              <span className="ui-muted">
                {session.status} · updated {session.updatedAt}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
