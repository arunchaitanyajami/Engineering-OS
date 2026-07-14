import type { LogEntry, LogTransport } from "@engineering-os/logger";
import type { DesktopPlatform } from "@engineering-os/platform";

export class PlatformLogTransport implements LogTransport {
  constructor(private readonly platform: DesktopPlatform) {}

  write(entry: LogEntry): void {
    void this.platform.writeLogEntry({
      timestamp: entry.timestamp,
      level: entry.level,
      scope: entry.component,
      message: entry.message,
      ...(entry.metadata ? { context: entry.metadata } : {}),
      ...(entry.correlationId ? { correlationId: entry.correlationId } : {})
    });
  }
}

export class CompositeLogTransport implements LogTransport {
  constructor(private readonly transports: readonly LogTransport[]) {}

  write(entry: LogEntry): void {
    this.transports.forEach((transport) => transport.write(entry));
  }
}
