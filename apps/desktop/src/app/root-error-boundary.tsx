import {
  Component,
  type ErrorInfo,
  type PropsWithChildren,
  type ReactNode
} from "react";

import { Button, ErrorState } from "@engineering-os/ui";

interface RootErrorBoundaryState {
  readonly error: Error | null;
}

export class RootErrorBoundary extends Component<
  PropsWithChildren,
  RootErrorBoundaryState
> {
  override state: RootErrorBoundaryState = {
    error: null
  };

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Root render failure", error, errorInfo);
    this.setState({ error });
  }

  override render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="app-root-fallback">
        <ErrorState
          title="Engineering OS crashed"
          description={
            import.meta.env.DEV
              ? this.state.error.message
              : "The desktop shell hit an unrecoverable rendering error."
          }
          action={
            <Button onClick={() => window.location.reload()}>Reload</Button>
          }
        />
      </div>
    );
  }
}
