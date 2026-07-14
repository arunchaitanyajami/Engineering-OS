import { ApplicationConfigStore } from "@engineering-os/config";
import { createLogger } from "@engineering-os/logger";
import { Button, ErrorState, LoadingState } from "@engineering-os/ui";

import { RootErrorBoundary } from "./app/root-error-boundary";
import { TauriDesktopPlatform } from "./platform/tauri-desktop-platform";
import { AppRouter } from "./routes/router";
import { DesktopConfigStorage } from "./services/desktop-config-storage";
import {
  CompositeLogTransport,
  PlatformLogTransport
} from "./services/platform-log-transport";
import {
  ApplicationStoreProvider,
  useApplicationActions,
  useApplicationState
} from "./stores/application-store";

const platform = new TauriDesktopPlatform();
const configStore = new ApplicationConfigStore(
  new DesktopConfigStorage(platform)
);
const logger = createLogger({
  component: "desktop-shell",
  transport: new CompositeLogTransport([new PlatformLogTransport(platform)])
});

function ApplicationBootstrap() {
  const { retryInitialization } = useApplicationActions();
  const { initializationState } = useApplicationState();

  if (initializationState.status === "failed") {
    return (
      <div className="app-root-fallback">
        <ErrorState
          title="Initialization failed"
          description={initializationState.error.userMessage}
          action={<Button onClick={retryInitialization}>Retry</Button>}
        />
      </div>
    );
  }

  if (initializationState.status !== "ready") {
    return (
      <div className="app-root-fallback">
        <LoadingState
          title="Starting Engineering OS"
          description={`Current stage: ${initializationState.status}`}
        />
      </div>
    );
  }

  return <AppRouter />;
}

export default function App() {
  return (
    <RootErrorBoundary>
      <ApplicationStoreProvider
        configStore={configStore}
        logger={logger}
        platform={platform}
      >
        <ApplicationBootstrap />
      </ApplicationStoreProvider>
    </RootErrorBoundary>
  );
}
