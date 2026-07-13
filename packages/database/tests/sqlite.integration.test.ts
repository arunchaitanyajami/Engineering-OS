import { afterEach, describe, expect, it } from "vitest";

import { SqliteDatabase } from "@engineering-os/database";
import { createAuditEventFixture } from "@engineering-os/testing";

describe("SqliteDatabase", () => {
  const databases: SqliteDatabase[] = [];

  afterEach(() => {
    databases.forEach((database) => database.close());
    databases.length = 0;
  });

  it("runs foundation migrations and records audit events", () => {
    const database = new SqliteDatabase(":memory:");
    databases.push(database);

    database.runMigrations();
    database.recordAuditEvent(
      createAuditEventFixture({
        id: "audit-1",
        action: "demo.record"
      })
    );

    expect(database.queryTableNames()).toEqual(
      expect.arrayContaining([
        "app_settings",
        "audit_events",
        "feature_flags",
        "installed_plugins",
        "plugin_permissions",
        "schema_migrations"
      ])
    );
  });
});
