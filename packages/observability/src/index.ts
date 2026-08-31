import {
  createLogger,
  type Logger,
  type LogLevel
} from "@engineering-os/logger";

export type { Logger, LogLevel };
export { createLogger };

export const observabilityEvents = {
  pluginDiscovered: "plugin.discovered",
  pluginValidated: "plugin.validated",
  pluginEnabled: "plugin.enabled",
  pluginStarted: "plugin.started",
  pluginFailed: "plugin.failed",
  pluginStopped: "plugin.stopped",
  mcpServerStarting: "mcp.server.starting",
  mcpServerConnected: "mcp.server.connected",
  mcpServerCapabilitiesDiscovered: "mcp.server.capabilities_discovered",
  mcpServerDisconnected: "mcp.server.disconnected",
  mcpServerCrashed: "mcp.server.crashed",
  toolExecutionRequested: "tool.execution.requested",
  toolExecutionApproved: "tool.execution.approved",
  toolExecutionStarted: "tool.execution.started",
  toolExecutionCompleted: "tool.execution.completed",
  toolExecutionFailed: "tool.execution.failed",
  toolExecutionCancelled: "tool.execution.cancelled"
} as const;

export type ObservabilityEvent =
  (typeof observabilityEvents)[keyof typeof observabilityEvents];

export interface ObservabilityContext {
  readonly component: string;
  readonly correlationId?: string;
}

export const createObservabilityLogger = (
  context: ObservabilityContext
): Logger =>
  createLogger({
    component: context.component,
    ...(context.correlationId ? { correlationId: context.correlationId } : {})
  });

export const classifyError = (
  error: unknown
): Readonly<Record<string, unknown>> => {
  if (error instanceof Error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : error.name;

    return {
      errorCode: code,
      errorName: error.name
    };
  }

  return {
    errorCode: "UNKNOWN_ERROR",
    errorName: "UnknownError"
  };
};

export const logObservabilityEvent = (
  logger: Logger,
  level: LogLevel,
  event: ObservabilityEvent,
  metadata: Readonly<Record<string, unknown>> = {},
  error?: unknown
): void => {
  if (level === "error") {
    logger.error(event, error, metadata);
    return;
  }

  logger[level](event, metadata);
};
