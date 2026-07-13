import { isRecord } from "@engineering-os/shared";
import { REDACTED_VALUE, redactKeys } from "@engineering-os/security";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly component: string;
  readonly correlationId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly error?: unknown;
  readonly timestamp: string;
}

export interface LogTransport {
  write(entry: LogEntry): void;
}

export interface Logger {
  child(
    bindings: Partial<Pick<LogEntry, "component" | "correlationId">>
  ): Logger;
  trace(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  debug(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  info(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  warn(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  error(
    message: string,
    error?: unknown,
    metadata?: Readonly<Record<string, unknown>>
  ): void;
}

export const serializeError = (
  error: unknown
): Readonly<Record<string, unknown>> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    value: error
  };
};

const shouldRedact = (key: string): boolean =>
  redactKeys.some((candidate) =>
    key.toLowerCase().includes(candidate.toLowerCase())
  );

export const redactMetadata = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactMetadata(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const entries = Object.entries(value);

  return Object.fromEntries(
    entries.map(([key, nestedValue]) => [
      key,
      shouldRedact(key) ? REDACTED_VALUE : redactMetadata(nestedValue)
    ])
  );
};

class ConsoleTransport implements LogTransport {
  write(entry: LogEntry): void {
    const output = {
      ...entry,
      metadata: entry.metadata ? redactMetadata(entry.metadata) : undefined,
      error: entry.error ? serializeError(entry.error) : undefined
    };

    const rendered = JSON.stringify(output);

    if (entry.level === "error" || entry.level === "warn") {
      console.error(rendered);
      return;
    }

    console.log(rendered);
  }
}

class StructuredLogger implements Logger {
  constructor(
    private readonly component: string,
    private readonly transport: LogTransport,
    private readonly correlationId?: string
  ) {}

  child(
    bindings: Partial<Pick<LogEntry, "component" | "correlationId">>
  ): Logger {
    return new StructuredLogger(
      bindings.component ?? this.component,
      this.transport,
      bindings.correlationId ?? this.correlationId
    );
  }

  trace(message: string, metadata?: Readonly<Record<string, unknown>>): void {
    this.write("trace", message, metadata);
  }

  debug(message: string, metadata?: Readonly<Record<string, unknown>>): void {
    this.write("debug", message, metadata);
  }

  info(message: string, metadata?: Readonly<Record<string, unknown>>): void {
    this.write("info", message, metadata);
  }

  warn(message: string, metadata?: Readonly<Record<string, unknown>>): void {
    this.write("warn", message, metadata);
  }

  error(
    message: string,
    error?: unknown,
    metadata?: Readonly<Record<string, unknown>>
  ): void {
    const options: {
      metadata?: Readonly<Record<string, unknown>>;
      error?: unknown;
    } = {};

    if (metadata) {
      options.metadata = metadata;
    }

    if (error) {
      options.error = error;
    }

    this.transport.write(this.createEntry("error", message, options));
  }

  private write(
    level: LogLevel,
    message: string,
    metadata?: Readonly<Record<string, unknown>>
  ) {
    const options: {
      metadata?: Readonly<Record<string, unknown>>;
    } = {};

    if (metadata) {
      options.metadata = metadata;
    }

    this.transport.write(this.createEntry(level, message, options));
  }

  private createEntry(
    level: LogLevel,
    message: string,
    options: {
      readonly metadata?: Readonly<Record<string, unknown>>;
      readonly error?: unknown;
    }
  ): LogEntry {
    return {
      level,
      message,
      component: this.component,
      ...(this.correlationId ? { correlationId: this.correlationId } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
      ...(options.error ? { error: options.error } : {}),
      timestamp: new Date().toISOString()
    };
  }
}

export interface CreateLoggerOptions {
  readonly component: string;
  readonly correlationId?: string;
  readonly transport?: LogTransport;
}

export const createLogger = (options: CreateLoggerOptions): Logger =>
  new StructuredLogger(
    options.component,
    options.transport ?? new ConsoleTransport(),
    options.correlationId
  );
