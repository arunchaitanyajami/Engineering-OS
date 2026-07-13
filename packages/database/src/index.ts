import Database from "better-sqlite3";

import type { Logger } from "@engineering-os/logger";
import type { AuditEvent } from "@engineering-os/security";

export interface SqlMigration {
  readonly id: string;
  readonly description: string;
  readonly sql: string;
}

export const foundationMigrations: readonly SqlMigration[] = [
  {
    id: "0001_foundation_schema",
    description: "Create the Milestone 0 foundation tables.",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feature_flags (
        key TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS installed_plugins (
        plugin_id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        installed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plugin_permissions (
        plugin_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted INTEGER NOT NULL DEFAULT 0,
        granted_at TEXT,
        PRIMARY KEY (plugin_id, permission)
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        outcome TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        metadata_json TEXT
      );
    `
  }
];

export interface DatabaseHealth {
  readonly ok: boolean;
  readonly userVersion: number;
}

export class SqliteDatabase {
  private readonly connection: Database.Database;

  constructor(
    filePath: string,
    private readonly logger?: Logger
  ) {
    this.connection = new Database(filePath);
    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("foreign_keys = ON");
  }

  close(): void {
    this.connection.close();
  }

  runMigrations(
    migrations: readonly SqlMigration[] = foundationMigrations
  ): void {
    const hasMigrationStatement = this.connection.prepare(
      "SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
    );
    const migrationTableExists =
      (hasMigrationStatement.get() as { count: number }).count > 0;

    if (!migrationTableExists) {
      this.connection.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          description TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
    }

    const getAppliedMigration = this.connection.prepare(
      "SELECT id FROM schema_migrations WHERE id = ?"
    );
    const insertMigration = this.connection.prepare(
      "INSERT INTO schema_migrations (id, description, applied_at) VALUES (?, ?, ?)"
    );

    const applyMigration = this.connection.transaction(
      (migration: SqlMigration) => {
        this.connection.exec(migration.sql);
        insertMigration.run(
          migration.id,
          migration.description,
          new Date().toISOString()
        );
        this.logger?.info("Applied SQLite migration.", {
          migrationId: migration.id
        });
      }
    );

    migrations.forEach((migration) => {
      const existingMigration = getAppliedMigration.get(migration.id) as
        { id: string } | undefined;

      if (!existingMigration) {
        applyMigration(migration);
      }
    });
  }

  healthCheck(): DatabaseHealth {
    const row = this.connection.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };

    return {
      ok: true,
      userVersion: row.user_version
    };
  }

  recordAuditEvent(event: AuditEvent): void {
    const statement = this.connection.prepare(`
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    statement.run(
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
    );
  }

  queryTableNames(): readonly string[] {
    const rows = this.connection
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      )
      .all() as Array<{ name: string }>;

    return rows.map((row) => row.name);
  }
}
