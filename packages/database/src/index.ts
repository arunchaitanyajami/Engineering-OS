import { createRequire } from "node:module";
import type * as SqliteModule from "node:sqlite";

import type { Logger } from "@engineering-os/logger";
import type { EngineeringSession } from "@engineering-os/platform";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof SqliteModule;
type DatabaseConnection = InstanceType<typeof DatabaseSync>;

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
