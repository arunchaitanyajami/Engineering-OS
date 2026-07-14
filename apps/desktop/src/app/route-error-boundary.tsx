import { useRouteError } from "react-router-dom";

import { Button, ErrorState } from "@engineering-os/ui";

import { normalizeApplicationError } from "../services/application-errors";

export function RouteErrorBoundary() {
  const routeError = useRouteError();
  const error = normalizeApplicationError(routeError, {
    code: "ROUTE_RENDER_FAILED",
    userMessage: "This route could not be rendered."
  });

  return (
    <div className="app-route-fallback">
      <ErrorState
        title="Route unavailable"
        description={import.meta.env.DEV ? error.message : error.userMessage}
        action={
          <Button onClick={() => window.location.reload()}>Reload</Button>
        }
      />
    </div>
  );
}
