import { afterEach, describe, expect, it } from "vitest";

import {
  ApplicationDatabase,
  applicationMigrations
} from "@engineering-os/database";

describe("ApplicationDatabase", () => {
  const databases: ApplicationDatabase[] = [];

  afterEach(() => {
    databases.forEach((database) => database.close());
    databases.length = 0;
  });

  it("runs milestone 1 migrations and persists sessions", () => {
    const database = new ApplicationDatabase(":memory:");
    databases.push(database);

    expect(database.runMigrations()).toBe(applicationMigrations.length);
    database.createSession({
      id: "session-1",
      title: "Session 1",
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
      status: "active"
    });

    expect(database.queryTableNames()).toEqual(
      expect.arrayContaining([
        "application_metadata",
        "engineering_sessions",
        "installed_plugins",
        "schema_migrations"
      ])
    );
    expect(database.listSessions()).toHaveLength(1);
    expect(database.getHealth()).toMatchObject({
      ok: true,
      migrationVersion: 4
    });
  });

  it("provides generic query helpers for repository adapters", () => {
    const database = new ApplicationDatabase(":memory:");
    databases.push(database);

    database.runMigrations();
    database.execute(
      `
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "registration-1",
        "com.engineering-os.filesystem",
        "/managed/plugins/filesystem/0.1.0",
        "managed",
        "local-directory",
        "/source/plugins/filesystem",
        "abc123",
        JSON.stringify({
          schemaVersion: "1",
          id: "com.engineering-os.filesystem",
          name: "Filesystem Plugin",
          version: "0.1.0",
          description: "Reference installed plugin.",
          publisher: {
            name: "Engineering OS"
          },
          engines: {
            engineeringOs: ">=0.1.0"
          },
          entrypoints: {
            backend: "./dist/backend/index.js"
          },
          capabilities: [],
          permissions: [],
          mcp: []
        }),
        "installed",
        0,
        "2026-07-14T00:00:00.000Z",
        "2026-07-14T00:00:00.000Z",
        null
      ]
    );

    expect(
      database.queryFirst(
        "SELECT plugin_id, install_root_path, enabled FROM installed_plugins WHERE plugin_id = ?",
        ["com.engineering-os.filesystem"]
      )
    ).toEqual({
      plugin_id: "com.engineering-os.filesystem",
      install_root_path: "/managed/plugins/filesystem/0.1.0",
      enabled: 0
    });
  });
});
