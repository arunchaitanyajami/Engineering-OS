import { randomUUID } from "node:crypto";

import {
  auditEventSchema,
  auditOutcomeSchema,
  redactKeys,
  REDACTED_VALUE,
  type AuditEvent,
  type AuditOutcome
} from "@engineering-os/contracts/unstable-runtime";
import {
  ApplicationDatabase,
  readOptionalString
} from "@engineering-os/database";

const readRequiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string") {
    throw new Error(`Expected '${fieldName}' to be a string.`);
  }

  return value;
};

const redactMetadata = (
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!metadata) {
    return undefined;
  }

  const redactedEntries = Object.entries(metadata).map(([key, value]) => {
    const normalizedKey = key.toLowerCase();

    if (
      redactKeys.some((redactKey) =>
        normalizedKey.includes(redactKey.toLowerCase())
      )
    ) {
      return [key, REDACTED_VALUE];
    }

    return [key, value];
  });

  return Object.fromEntries(redactedEntries);
};

const mapAuditRow = (row: Record<string, unknown>): AuditEvent => {
  const metadataJson = readOptionalString(row.metadata_json, "metadata_json");
  const actorId = readOptionalString(row.actor_id, "actor_id");
  const resourceType = readOptionalString(row.resource_type, "resource_type");
  const resourceId = readOptionalString(row.resource_id, "resource_id");

  return auditEventSchema.parse({
    id: readRequiredString(row.id, "id"),
    timestamp: readRequiredString(row.timestamp, "timestamp"),
    actorType: row.actor_type,
    ...(actorId ? { actorId } : {}),
    action: readRequiredString(row.action, "action"),
    ...(resourceType ? { resourceType } : {}),
    ...(resourceId ? { resourceId } : {}),
    outcome: auditOutcomeSchema.parse(row.outcome),
    correlationId: readRequiredString(row.correlation_id, "correlation_id"),
    ...(metadataJson ? { metadata: JSON.parse(metadataJson) } : {})
  });
};

export interface AuditRecordInput {
  readonly actorType: AuditEvent["actorType"];
  readonly actorId?: string;
  readonly action: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly outcome: AuditOutcome;
  readonly correlationId: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AuditListOptions {
  readonly limit?: number;
  readonly pluginId?: string;
  readonly action?: string;
}

export interface AuditRepository {
  append(input: AuditRecordInput): AuditEvent;
  list(options?: AuditListOptions): readonly AuditEvent[];
}

export class SqliteAuditRepository implements AuditRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  append(input: AuditRecordInput): AuditEvent {
    const timestamp = new Date().toISOString();
    const metadata = redactMetadata(input.metadata);
    const event = auditEventSchema.parse({
      id: randomUUID(),
      timestamp,
      actorType: input.actorType,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      action: input.action,
      ...(input.resourceType ? { resourceType: input.resourceType } : {}),
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      outcome: input.outcome,
      correlationId: input.correlationId,
      ...(metadata ? { metadata } : {})
    });

    this.database.execute(
      `
        INSERT INTO audit_events (
          id,
          timestamp,
          actor_type,
          actor_id,
          action,
          resource_type,
          resource_id,
          outcome,
          correlation_id,
          metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        event.id,
        event.timestamp,
        event.actorType,
        event.actorId ?? null,
        event.action,
        event.resourceType ?? null,
        event.resourceId ?? null,
        event.outcome,
        event.correlationId,
        event.metadata ? JSON.stringify(event.metadata) : null
      ]
    );

    return event;
  }

  list(options: AuditListOptions = {}): readonly AuditEvent[] {
    const limit = options.limit ?? 100;
    const filters: string[] = [];
    const parameters: Array<string | number> = [];

    if (options.pluginId) {
      filters.push("(resource_id = ? OR metadata_json LIKE ?)");
      parameters.push(options.pluginId, `%"pluginId":"${options.pluginId}"%`);
    }

    if (options.action) {
      filters.push("action = ?");
      parameters.push(options.action);
    }

    const whereClause =
      filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    return this.database
      .queryAll(
        `
          SELECT
            id,
            timestamp,
            actor_type,
            actor_id,
            action,
            resource_type,
            resource_id,
            outcome,
            correlation_id,
            metadata_json
          FROM audit_events
          ${whereClause}
          ORDER BY timestamp DESC, id DESC
          LIMIT ?
        `,
        [...parameters, limit]
      )
      .map(mapAuditRow);
  }
}
