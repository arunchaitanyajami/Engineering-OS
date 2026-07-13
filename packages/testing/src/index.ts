import {
  createLogger,
  type LogEntry,
  type LogTransport
} from "@engineering-os/logger";
import { type AuditEvent } from "@engineering-os/security";

export class InMemoryLogTransport implements LogTransport {
  readonly entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

export const createTestLogger = () => {
  const transport = new InMemoryLogTransport();

  return {
    logger: createLogger({
      component: "test",
      transport
    }),
    transport
  };
};

export const createAuditEventFixture = (
  overrides: Partial<AuditEvent> = {}
): AuditEvent => ({
  id: "audit-event-1",
  timestamp: "2026-01-01T00:00:00.000Z",
  actorType: "system",
  action: "foundation.test",
  outcome: "success",
  correlationId: "corr-1",
  ...overrides
});
