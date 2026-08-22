import { randomUUID } from "node:crypto";

import {
  persistedPluginPermissionGrantSchema,
  permissionGrantDecisionSchema,
  type PersistedPluginPermissionGrant,
  type PermissionGrantDecision
} from "@engineering-os/contracts/unstable-runtime";
import { permissionScopeSchema } from "@engineering-os/contracts";
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

const mapGrantRow = (
  row: Record<string, unknown>
): PersistedPluginPermissionGrant => {
  const constraintJson = readOptionalString(row.constraint_json, "constraint_json");
  const revokedAt = readOptionalString(row.revoked_at, "revoked_at");

  return persistedPluginPermissionGrantSchema.parse({
    id: readRequiredString(row.id, "id"),
    pluginId: readRequiredString(row.plugin_id, "plugin_id"),
    scope: permissionScopeSchema.parse(row.scope),
    ...(constraintJson ? { constraint: JSON.parse(constraintJson) } : {}),
    decision: permissionGrantDecisionSchema.parse(row.decision),
    grantedAt: readRequiredString(row.granted_at, "granted_at"),
    ...(revokedAt ? { revokedAt } : {})
  });
};

export interface PermissionGrantRepository {
  listByPluginId(pluginId: string): readonly PersistedPluginPermissionGrant[];
  upsertGrant(input: {
    readonly pluginId: string;
    readonly scope: PersistedPluginPermissionGrant["scope"];
    readonly constraint?: Record<string, unknown>;
    readonly decision: PermissionGrantDecision;
    readonly grantedAt: string;
  }): PersistedPluginPermissionGrant;
  revokeGrant(
    pluginId: string,
    scope: PersistedPluginPermissionGrant["scope"],
    revokedAt: string
  ): PersistedPluginPermissionGrant | null;
}

export class SqlitePermissionGrantRepository implements PermissionGrantRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  listByPluginId(pluginId: string): readonly PersistedPluginPermissionGrant[] {
    return this.database
      .queryAll(
        `
          SELECT
            id,
            plugin_id,
            scope,
            constraint_json,
            decision,
            granted_at,
            revoked_at
          FROM plugin_permissions
          WHERE plugin_id = ?
          ORDER BY granted_at ASC, scope ASC
        `,
        [pluginId]
      )
      .map(mapGrantRow);
  }

  upsertGrant(input: {
    readonly pluginId: string;
    readonly scope: PersistedPluginPermissionGrant["scope"];
    readonly constraint?: Record<string, unknown>;
    readonly decision: PermissionGrantDecision;
    readonly grantedAt: string;
  }): PersistedPluginPermissionGrant {
    const activeGrant = this.database.queryFirst(
      `
        SELECT id
        FROM plugin_permissions
        WHERE plugin_id = ? AND scope = ? AND revoked_at IS NULL
      `,
      [input.pluginId, input.scope]
    );

    if (activeGrant) {
      this.database.execute(
        `
          UPDATE plugin_permissions
          SET
            constraint_json = ?,
            decision = ?,
            granted_at = ?,
            revoked_at = NULL
          WHERE id = ?
        `,
        [
          input.constraint ? JSON.stringify(input.constraint) : null,
          input.decision,
          input.grantedAt,
          readRequiredString(activeGrant.id, "id")
        ]
      );
    } else {
      this.database.execute(
        `
          INSERT INTO plugin_permissions (
            id,
            plugin_id,
            scope,
            constraint_json,
            decision,
            granted_at,
            revoked_at
          )
          VALUES (?, ?, ?, ?, ?, ?, NULL)
        `,
        [
          randomUUID(),
          input.pluginId,
          input.scope,
          input.constraint ? JSON.stringify(input.constraint) : null,
          input.decision,
          input.grantedAt
        ]
      );
    }

    const persistedGrant = this.database.queryFirst(
      `
        SELECT
          id,
          plugin_id,
          scope,
          constraint_json,
          decision,
          granted_at,
          revoked_at
        FROM plugin_permissions
        WHERE plugin_id = ? AND scope = ? AND revoked_at IS NULL
      `,
      [input.pluginId, input.scope]
    );

    if (!persistedGrant) {
      throw new Error(
        `Permission grant for '${input.pluginId}' scope '${input.scope}' could not be read after upsert.`
      );
    }

    return mapGrantRow(persistedGrant);
  }

  revokeGrant(
    pluginId: string,
    scope: PersistedPluginPermissionGrant["scope"],
    revokedAt: string
  ): PersistedPluginPermissionGrant | null {
    const activeGrant = this.database.queryFirst(
      `
        SELECT
          id,
          plugin_id,
          scope,
          constraint_json,
          decision,
          granted_at,
          revoked_at
        FROM plugin_permissions
        WHERE plugin_id = ? AND scope = ? AND revoked_at IS NULL
      `,
      [pluginId, scope]
    );

    if (!activeGrant) {
      return null;
    }

    this.database.execute(
      `
        UPDATE plugin_permissions
        SET revoked_at = ?
        WHERE id = ?
      `,
      [revokedAt, readRequiredString(activeGrant.id, "id")]
    );

    return mapGrantRow({
      ...activeGrant,
      revoked_at: revokedAt
    });
  }
}
