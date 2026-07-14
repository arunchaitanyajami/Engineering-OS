import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { LoadingState } from "@engineering-os/ui";

import { useApplicationActions } from "../../stores/application-store";

export function CreateSessionRoute() {
  const navigate = useNavigate();
  const { createSession } = useApplicationActions();

  useEffect(() => {
    const session = createSession();
    void navigate(`/sessions/${session.id}`, { replace: true });
  }, [createSession, navigate]);

  return (
    <LoadingState
      title="Creating session"
      description="Preparing a new local engineering workspace shell."
    />
  );
}
