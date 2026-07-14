import { Link } from "react-router-dom";

import { Button, EmptyState } from "@engineering-os/ui";

export function NotFoundScreen() {
  return (
    <EmptyState
      title="Page not found"
      description="The requested desktop route does not exist."
      action={
        <Link to="/home">
          <Button>Return Home</Button>
        </Link>
      }
    />
  );
}
