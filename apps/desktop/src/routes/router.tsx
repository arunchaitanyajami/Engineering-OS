import { Suspense, lazy, type ReactNode } from "react";
import {
  Navigate,
  RouterProvider,
  createBrowserRouter
} from "react-router-dom";

import { LoadingState } from "@engineering-os/ui";

import { RouteErrorBoundary } from "../app/route-error-boundary";
import { DesktopShellLayout } from "../layouts/desktop-shell-layout";
import { FutureFeatureScreen } from "../features/placeholders/future-feature-screen";
import { NotFoundScreen } from "../features/placeholders/not-found-screen";

const HomeScreen = lazy(() =>
  import("../features/home/home-screen").then((module) => ({
    default: module.HomeScreen
  }))
);
const SessionsScreen = lazy(() =>
  import("../features/sessions/sessions-screen").then((module) => ({
    default: module.SessionsScreen
  }))
);
const SessionWorkspaceScreen = lazy(() =>
  import("../features/sessions/session-workspace-screen").then((module) => ({
    default: module.SessionWorkspaceScreen
  }))
);
const SettingsScreen = lazy(() =>
  import("../features/settings/settings-screen").then((module) => ({
    default: module.SettingsScreen
  }))
);
const CreateSessionRoute = lazy(() =>
  import("../features/sessions/create-session-route").then((module) => ({
    default: module.CreateSessionRoute
  }))
);

const withSuspense = (element: ReactNode) => (
  <Suspense
    fallback={
      <LoadingState
        title="Loading route"
        description="Preparing the desktop shell surface."
      />
    }
  >
    {element}
  </Suspense>
);

const router = createBrowserRouter([
  {
    path: "/",
    element: <DesktopShellLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: <Navigate replace to="/home" />
      },
      {
        path: "home",
        element: withSuspense(<HomeScreen />)
      },
      {
        path: "sessions",
        element: withSuspense(<SessionsScreen />)
      },
      {
        path: "sessions/new",
        element: withSuspense(<CreateSessionRoute />)
      },
      {
        path: "sessions/:sessionId",
        element: withSuspense(<SessionWorkspaceScreen />)
      },
      {
        path: "agents",
        element: (
          <FutureFeatureScreen
            description="Agent runtimes remain intentionally out of scope for Milestone 1."
            title="Agents"
          />
        )
      },
      {
        path: "plugins",
        element: (
          <FutureFeatureScreen
            description="Plugin SDK and installation flow arrive in Milestone 2."
            title="Plugins"
          />
        )
      },
      {
        path: "workflows",
        element: (
          <FutureFeatureScreen
            description="Workflow execution is deliberately deferred until the desktop foundation is stable."
            title="Workflows"
          />
        )
      },
      {
        path: "knowledge",
        element: (
          <FutureFeatureScreen
            description="Knowledge indexing and semantic search arrive in a later milestone."
            title="Knowledge"
          />
        )
      },
      {
        path: "settings",
        element: withSuspense(<SettingsScreen />)
      },
      {
        path: "*",
        element: <NotFoundScreen />
      }
    ]
  }
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
