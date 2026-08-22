import { randomUUID } from "node:crypto";

import {
  persistedToolPolicySchema,
  toolRiskLevelSchema,
  type PersistedToolPolicy,
  type ToolRiskLevel
} from "@engineering-os/contracts/unstable-runtime";
import { ApplicationDatabase } from "@engineering-os/database";

const readRequiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string") {
    throw new Error(`Expected '${fieldName}' to be a string.`);
  }

  return value;
};

const mapPolicyRow = (row: Record<string, unknown>): PersistedToolPolicy =>
  persistedToolPolicySchema.parse({
    id: readRequiredString(row.id, "id"),
    toolId: readRequiredString(row.tool_id, "tool_id"),
    riskLevel: toolRiskLevelSchema.parse(row.risk_level),
    source: "manual",
    updatedAt: readRequiredString(row.updated_at, "updated_at")
  });

export interface ToolPolicyRepository {
  getByToolId(toolId: string): PersistedToolPolicy | null;
  listManualPolicies(): readonly PersistedToolPolicy[];
  upsertManualPolicy(
    toolId: string,
    riskLevel: ToolRiskLevel,
    updatedAt: string
  ): PersistedToolPolicy;
}

export class SqliteToolPolicyRepository implements ToolPolicyRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  getByToolId(toolId: string): PersistedToolPolicy | null {
    const row = this.database.queryFirst(
      `
        SELECT
          id,
          tool_id,
          risk_level,
          source,
          updated_at
        FROM tool_policies
        WHERE tool_id = ? AND source = 'manual'
      `,
      [toolId]
    );

    return row ? mapPolicyRow(row) : null;
  }

  listManualPolicies(): readonly PersistedToolPolicy[] {
    return this.database
      .queryAll(
        `
          SELECT
            id,
            tool_id,
            risk_level,
            source,
            updated_at
          FROM tool_policies
          WHERE source = 'manual'
          ORDER BY updated_at DESC, tool_id ASC
        `
      )
      .map(mapPolicyRow);
  }

  upsertManualPolicy(
    toolId: string,
    riskLevel: ToolRiskLevel,
    updatedAt: string
  ): PersistedToolPolicy {
    const existingPolicy = this.database.queryFirst(
      `
        SELECT id
        FROM tool_policies
        WHERE tool_id = ?
      `,
      [toolId]
    );

    if (existingPolicy) {
      this.database.execute(
        `
          UPDATE tool_policies
          SET
            risk_level = ?,
            source = 'manual',
            updated_at = ?
          WHERE tool_id = ?
        `,
        [riskLevel, updatedAt, toolId]
      );
    } else {
      this.database.execute(
        `
          INSERT INTO tool_policies (
            id,
            tool_id,
            risk_level,
            source,
            updated_at
          )
          VALUES (?, ?, ?, 'manual', ?)
        `,
        [randomUUID(), toolId, riskLevel, updatedAt]
      );
    }

    const persistedPolicy = this.getByToolId(toolId);

    if (!persistedPolicy) {
      throw new Error(
        `Tool policy for '${toolId}' could not be read after upsert.`
      );
    }

    return persistedPolicy;
  }
}
