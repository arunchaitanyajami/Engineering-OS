import { createRequire } from "node:module";
import type * as SqliteModule from "node:sqlite";

import type { Logger } from "@engineering-os/logger";
import type { EngineeringSession } from "@engineering-os/platform";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof SqliteModule;
type DatabaseConnection = InstanceType<typeof DatabaseSync>;
type SqlParameter = SqliteModule.SQLInputValue;

export interface SqlMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface ApplicationDatabaseHealth {
  readonly ok: boolean;
  readonly migrationVersion: number;
  readonly databasePath: string;
}

export const applicationMigrations: readonly SqlMigration[] = [
  {
    version: 1,
    name: "application_metadata",
    sql: `
      CREATE TABLE IF NOT EXISTS application_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    name: "engineering_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS engineering_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_engineering_sessions_updated_at
        ON engineering_sessions(updated_at DESC);
    `
  },
  {
    version: 3,
    name: "installed_plugins",
    sql: `
      CREATE TABLE IF NOT EXISTS installed_plugins (
        id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT NOT NULL,
        install_path TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        state TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_installed_plugins_updated_at
        ON installed_plugins(updated_at DESC);
    `
  },
  {
    version: 4,
    name: "installed_plugins_managed_installation",
    sql: `
      ALTER TABLE installed_plugins RENAME TO installed_plugins_legacy;

      CREATE TABLE installed_plugins (
        id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL UNIQUE,
        install_root_path TEXT NOT NULL UNIQUE,
        installation_mode TEXT NOT NULL CHECK (
          installation_mode IN ('managed', 'development-link')
        ),
        source_type TEXT NOT NULL CHECK (
          source_type IN ('local-directory')
        ),
        source_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('installed', 'incompatible', 'removed')
        ),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (
          enabled IN (0, 1)
        ),
        installed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT
      );

      INSERT INTO installed_plugins (
        id,
        plugin_id,
        install_root_path,
        installation_mode,
        source_type,
        source_path,
        content_hash,
        manifest_json,
        state,
        enabled,
        installed_at,
        updated_at,
        last_error
      )
      SELECT
        id,
        plugin_id,
        install_path,
        'development-link',
        'local-directory',
        install_path,
        '',
        manifest_json,
        CASE
          WHEN state IN ('installed', 'incompatible', 'removed') THEN state
          ELSE 'installed'
        END,
        CASE
          WHEN enabled IN (0, 1) THEN enabled
          ELSE 0
        END,
        installed_at,
        updated_at,
        last_error
      FROM installed_plugins_legacy;

      DROP TABLE installed_plugins_legacy;

      CREATE INDEX IF NOT EXISTS idx_installed_plugins_updated_at
        ON installed_plugins(updated_at DESC);
    `
  },
  {
    version: 5,
    name: "plugin_permissions",
    sql: `
      CREATE TABLE IF NOT EXISTS plugin_permissions (
        id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        constraint_json TEXT,
        decision TEXT NOT NULL CHECK (
          decision IN ('deny', 'allow-once', 'allow-for-session', 'always-allow')
        ),
        granted_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_permissions_plugin_id
        ON plugin_permissions(plugin_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_permissions_active_scope
        ON plugin_permissions(plugin_id, scope)
        WHERE revoked_at IS NULL;
    `
  },
  {
    version: 6,
    name: "tool_policies",
    sql: `
      CREATE TABLE IF NOT EXISTS tool_policies (
        id TEXT PRIMARY KEY,
        tool_id TEXT NOT NULL UNIQUE,
        risk_level TEXT NOT NULL CHECK (
          risk_level IN (
            'read-only',
            'write',
            'destructive',
            'privileged',
            'unknown'
          )
        ),
        source TEXT NOT NULL CHECK (source IN ('manual', 'inferred')),
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tool_policies_updated_at
        ON tool_policies(updated_at DESC);
    `
  },
  {
    version: 7,
    name: "audit_events",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK (
          actor_type IN ('user', 'agent', 'workflow', 'plugin', 'system')
        ),
        actor_id TEXT,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        outcome TEXT NOT NULL CHECK (
          outcome IN ('success', 'failure', 'denied', 'cancelled')
        ),
        correlation_id TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp
        ON audit_events(timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_audit_events_correlation_id
        ON audit_events(correlation_id);
    `
  },
  {
    version: 8,
    name: "milestone_2_data_model",
    sql: `
      CREATE TABLE IF NOT EXISTS plugin_settings (
        id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_settings_plugin_key
        ON plugin_settings(plugin_id, key);

      CREATE INDEX IF NOT EXISTS idx_plugin_settings_updated_at
        ON plugin_settings(updated_at DESC);

      CREATE TABLE IF NOT EXISTS plugin_runtime_state (
        plugin_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (
          status IN ('stopped', 'starting', 'running', 'stopping', 'failed')
        ),
        healthy INTEGER NOT NULL CHECK (healthy IN (0, 1)),
        process_id INTEGER,
        initialized_at TEXT,
        activated_at TEXT,
        restart_count INTEGER NOT NULL DEFAULT 0 CHECK (restart_count >= 0),
        last_error TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_runtime_state_updated_at
        ON plugin_runtime_state(updated_at DESC);

      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        server_key TEXT NOT NULL UNIQUE,
        plugin_id TEXT,
        name TEXT NOT NULL,
        transport TEXT NOT NULL CHECK (
          transport IN ('stdio', 'streamable-http')
        ),
        configuration_json TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        status TEXT NOT NULL CHECK (
          status IN ('registered', 'disabled')
        ),
        protocol_version TEXT,
        last_connected_at TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_mcp_servers_plugin_id
        ON mcp_servers(plugin_id);

      CREATE INDEX IF NOT EXISTS idx_mcp_servers_updated_at
        ON mcp_servers(updated_at DESC);

      CREATE TABLE IF NOT EXISTS mcp_capabilities (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        capability_type TEXT NOT NULL CHECK (
          capability_type IN ('tool', 'resource', 'prompt')
        ),
        capability_name TEXT NOT NULL,
        descriptor_json TEXT NOT NULL,
        descriptor_hash TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_capabilities_server_descriptor
        ON mcp_capabilities(server_id, capability_type, capability_name);

      CREATE INDEX IF NOT EXISTS idx_mcp_capabilities_discovered_at
        ON mcp_capabilities(discovered_at DESC);

      CREATE TABLE IF NOT EXISTS execution_audit (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL UNIQUE,
        plugin_id TEXT,
        server_id TEXT NOT NULL,
        capability_name TEXT NOT NULL,
        risk_level TEXT NOT NULL CHECK (
          risk_level IN (
            'read-only',
            'write',
            'destructive',
            'privileged',
            'unknown'
          )
        ),
        request_summary TEXT NOT NULL,
        result_status TEXT NOT NULL CHECK (
          result_status IN ('success', 'failure', 'denied', 'cancelled')
        ),
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        FOREIGN KEY (plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_execution_audit_started_at
        ON execution_audit(started_at DESC);

      CREATE INDEX IF NOT EXISTS idx_execution_audit_plugin_id
        ON execution_audit(plugin_id);
    `
  },
  {
    version: 9,
    name: "workspaces_and_plugin_connections",
    sql: `
      CREATE TABLE IF NOT EXISTS engineering_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_engineering_workspaces_updated_at
        ON engineering_workspaces(updated_at DESC);

      CREATE TABLE IF NOT EXISTS plugin_connections (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        credential_ref TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('connected', 'disconnected', 'expired', 'error')
        ),
        auth_method_json TEXT NOT NULL,
        account_login TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES engineering_workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (plugin_id) REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_connections_workspace_plugin
        ON plugin_connections(workspace_id, plugin_id);

      CREATE INDEX IF NOT EXISTS idx_plugin_connections_updated_at
        ON plugin_connections(updated_at DESC);
    `
  }
];

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

const createSchemaMigrationsTableSql = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

const readRequiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string") {
    throw new Error(`Expected '${fieldName}' to be a string.`);
  }

  return value;
};

export const readRequiredBoolean = (
  value: unknown,
  fieldName: string
): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === 0 || value === 1) {
    return value === 1;
  }

  throw new Error(`Expected '${fieldName}' to be a boolean.`);
};

export const readOptionalString = (
  value: unknown,
  fieldName: string
): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  return readRequiredString(value, fieldName);
};

const beginTransaction = (database: DatabaseConnection) => {
  database.exec("BEGIN IMMEDIATE");
};

const commitTransaction = (database: DatabaseConnection) => {
  database.exec("COMMIT");
};

const rollbackTransaction = (database: DatabaseConnection) => {
  if (database.isTransaction) {
    database.exec("ROLLBACK");
  }
};

export class ApplicationDatabase {
  private readonly connection: DatabaseConnection;

  constructor(
    private readonly filePath: string,
    private readonly logger?: Logger
  ) {
    this.connection = new DatabaseSync(filePath);
    this.connection.exec(
      [
        "PRAGMA journal_mode = WAL",
        "PRAGMA foreign_keys = ON",
        `PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`
      ].join(";")
    );
  }

  close(): void {
    this.connection.close();
  }

  runMigrations(
    migrations: readonly SqlMigration[] = applicationMigrations
  ): number {
    this.connection.exec(createSchemaMigrationsTableSql);

    const findAppliedMigration = this.connection.prepare(
      "SELECT version FROM schema_migrations WHERE version = ?"
    );
    const insertMigration = this.connection.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
    );

    for (const migration of migrations) {
      const existingMigration = findAppliedMigration.get(migration.version) as
        { version: number } | undefined;

      if (existingMigration) {
        continue;
      }

      beginTransaction(this.connection);

      try {
        this.connection.exec(migration.sql);
        insertMigration.run(
          migration.version,
          migration.name,
          new Date().toISOString()
        );
        commitTransaction(this.connection);
        this.logger?.info("Applied SQLite migration.", {
          migrationVersion: migration.version,
          migrationName: migration.name
        });
      } catch (error) {
        rollbackTransaction(this.connection);
        throw error;
      }
    }

    return this.getMigrationVersion();
  }

  getHealth(): ApplicationDatabaseHealth {
    return {
      ok: true,
      migrationVersion: this.getMigrationVersion(),
      databasePath: this.filePath
    };
  }

  setMetadata(key: string, value: string): void {
    const statement = this.connection.prepare(`
      INSERT INTO application_metadata (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    statement.run(key, value);
  }

  listSessions(): readonly EngineeringSession[] {
    const statement = this.connection.prepare(`
      SELECT id, title, created_at, updated_at, status
      FROM engineering_sessions
      ORDER BY updated_at DESC
    `);

    const rows = statement.all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: readRequiredString(row.id, "id"),
      title: readRequiredString(row.title, "title"),
      createdAt: readRequiredString(row.created_at, "created_at"),
      updatedAt: readRequiredString(row.updated_at, "updated_at"),
      status: readRequiredString(
        row.status,
        "status"
      ) as EngineeringSession["status"]
    }));
  }

  createSession(session: EngineeringSession): EngineeringSession {
    const statement = this.connection.prepare(`
      INSERT INTO engineering_sessions (id, title, created_at, updated_at, status)
      VALUES (?, ?, ?, ?, ?)
    `);

    statement.run(
      session.id,
      session.title,
      session.createdAt,
      session.updatedAt,
      session.status
    );

    return session;
  }

  execute(sql: string, parameters: readonly SqlParameter[] = []): void {
    this.connection.prepare(sql).run(...parameters);
  }

  queryFirst(
    sql: string,
    parameters: readonly SqlParameter[] = []
  ): Record<string, unknown> | null {
    const row = this.connection.prepare(sql).get(...parameters) as
      Record<string, unknown> | undefined;

    return row ?? null;
  }

  queryAll(
    sql: string,
    parameters: readonly SqlParameter[] = []
  ): readonly Record<string, unknown>[] {
    return this.connection.prepare(sql).all(...parameters) as Array<
      Record<string, unknown>
    >;
  }

  queryTableNames(): readonly string[] {
    const rows = this.connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => readRequiredString(row.name, "name"));
  }

  private getMigrationVersion(): number {
    const row = this.connection
      .prepare(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations"
      )
      .get() as Record<string, unknown>;

    const version = row.version;

    if (typeof version !== "number") {
      throw new Error("Failed to read the current schema migration version.");
    }

    return version;
  }
}
