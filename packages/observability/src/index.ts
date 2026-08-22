import {
  createLogger,
  type Logger,
  type LogLevel
} from "@engineering-os/logger";

export type { Logger, LogLevel };
export { createLogger };

export interface ObservabilityContext {
  readonly component: string;
  readonly correlationId?: string;
}

export const createObservabilityLogger = (
  context: ObservabilityContext
): Logger =>
  createLogger({
    component: context.component,
    ...(context.correlationId
      ? { correlationId: context.correlationId }
      : {})
  });
