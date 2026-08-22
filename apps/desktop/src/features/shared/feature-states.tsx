import { Badge, ErrorState, LoadingState } from "@engineering-os/ui";

import {
  isDesktopBackendAvailable
} from "../../services/desktop-backend-request.js";

export function BackendUnavailableNotice({
  title = "Desktop backend unavailable",
  description = "Plugin and MCP management requires the Tauri desktop runtime with the local backend running."
}: {
  readonly title?: string;
  readonly description?: string;
}) {
  if (isDesktopBackendAvailable()) {
    return null;
  }

  return (
    <div className="screen-layout">
      <ErrorState
        title={title}
        description={description}
        action={<Badge tone="warning">Browser preview mode</Badge>}
      />
    </div>
  );
}

export function FeatureLoadingState({
  title,
  description
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="screen-layout">
      <LoadingState title={title} description={description} />
    </div>
  );
}

export function FeatureErrorState({
  title,
  description,
  onRetry
}: {
  readonly title: string;
  readonly description: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="screen-layout">
      <ErrorState
        title={title}
        description={description}
        action={
          onRetry ? (
            <button className="ui-button" onClick={onRetry} type="button">
              Retry
            </button>
          ) : undefined
        }
      />
    </div>
  );
}

const toneForRisk = (
  riskLevel: string
): "neutral" | "success" | "warning" | "error" => {
  switch (riskLevel) {
    case "read-only":
      return "success";
    case "write":
      return "warning";
    case "destructive":
    case "privileged":
      return "error";
    default:
      return "neutral";
  }
};

export const riskBadgeTone = toneForRisk;

export const formatJson = (value: unknown): string =>
  JSON.stringify(value, null, 2);
