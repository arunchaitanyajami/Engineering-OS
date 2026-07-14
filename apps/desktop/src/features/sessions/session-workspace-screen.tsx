import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { EmptyState, PageHeader, PanelCard } from "@engineering-os/ui";

import { useApplicationState } from "../../stores/application-store";

export function SessionWorkspaceScreen() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { sessions } = useApplicationState();
  const session = useMemo(
    () => sessions.find((candidate) => candidate.id === sessionId),
    [sessionId, sessions]
  );

  if (!session) {
    return (
      <EmptyState
        title="Session not found"
        description="The selected local session shell does not exist."
      />
    );
  }

  return (
    <div className="screen-layout">
      <PageHeader
        eyebrow="Session"
        title={session.title}
        description="Session workspace shell with conversation, context, and activity placeholders."
      />

      <div className="workspace-grid">
        <PanelCard eyebrow="Conversation" title="Empty conversation">
          <EmptyState
            title="No messages yet"
            description="AI providers are intentionally not connected during Milestone 1."
          />
        </PanelCard>

        <PanelCard eyebrow="Composer" title="Input placeholder">
          <label className="form-field">
            <span>Prompt</span>
            <textarea
              aria-label="Session prompt"
              className="app-textarea"
              placeholder="Ask Engineering OS a question in a future milestone."
              rows={6}
            />
          </label>
        </PanelCard>

        <PanelCard eyebrow="Context" title="Context panel placeholder">
          <p className="ui-muted">
            Session context, attached files, and MCP-sourced knowledge will
            appear here in later milestones.
          </p>
        </PanelCard>

        <PanelCard eyebrow="Activity" title="Activity panel placeholder">
          <p className="ui-muted">
            Workflow and agent activity will appear here once those runtimes are
            introduced.
          </p>
        </PanelCard>
      </div>
    </div>
  );
}
