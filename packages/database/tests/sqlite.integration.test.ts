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
      migrationVersion: 3
    });
  });

  it("persists installed plugin registrations", () => {
    const database = new ApplicationDatabase(":memory:");
    databases.push(database);

    database.runMigrations();
    database.registerInstalledPlugin({
      id: "registration-1",
      pluginId: "com.engineering-os.filesystem",
      name: "Filesystem Plugin",
      version: "0.1.0",
      description: "Reference installed plugin.",
      installPath: "/plugins/filesystem",
      manifest: {
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
      },
      state: "installed",
      enabled: false,
      installedAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z"
    });

    expect(database.listInstalledPlugins()).toEqual([
      expect.objectContaining({
        pluginId: "com.engineering-os.filesystem",
        installPath: "/plugins/filesystem",
        state: "installed",
        enabled: false
      })
    ]);
  });
});
