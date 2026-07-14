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
