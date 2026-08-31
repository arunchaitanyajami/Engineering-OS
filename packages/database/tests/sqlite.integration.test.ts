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
      migrationVersion: 9
    });
  });

  it("creates milestone 2 plugin, MCP, and execution audit tables", () => {
    const database = new ApplicationDatabase(":memory:");
    databases.push(database);

    database.runMigrations();

    expect(database.queryTableNames()).toEqual(
      expect.arrayContaining([
        "plugin_settings",
        "plugin_runtime_state",
        "mcp_servers",
        "mcp_capabilities",
        "execution_audit",
        "plugin_permissions",
        "tool_policies",
        "audit_events"
      ])
    );
    expect(database.queryTableNames()).toEqual(
      expect.arrayContaining(["engineering_workspaces", "plugin_connections"])
    );

    const timestamp = "2026-08-22T00:00:00.000Z";

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
        "registration-m2",
        "com.engineering-os.milestone-two",
        "/managed/plugins/milestone-two/0.1.0",
        "managed",
        "local-directory",
        "/source/plugins/milestone-two",
        "abc123",
        JSON.stringify({
          schemaVersion: "1",
          id: "com.engineering-os.milestone-two",
          name: "Milestone Two Plugin",
          version: "0.1.0",
          description: "SQLite data model test plugin.",
          publisher: { name: "Engineering OS" },
          engines: { engineeringOs: ">=0.1.0" },
          entrypoints: { backend: "./dist/backend/index.js" },
          capabilities: [],
          permissions: [],
          mcp: []
        }),
        "installed",
        1,
        timestamp,
        timestamp,
        null
      ]
    );

    database.execute(
      `
        INSERT INTO plugin_settings (id, plugin_id, key, value_json, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        "setting-1",
        "com.engineering-os.milestone-two",
        "theme",
        JSON.stringify("dark"),
        timestamp
      ]
    );

    database.execute(
      `
        INSERT INTO plugin_runtime_state (
          plugin_id,
          status,
          healthy,
          restart_count,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      ["com.engineering-os.milestone-two", "running", 1, 0, timestamp]
    );

    database.execute(
      `
        INSERT INTO mcp_servers (
          id,
          server_key,
          plugin_id,
          name,
          transport,
          configuration_json,
          enabled,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "mcp-server-1",
        "com.engineering-os.milestone-two:filesystem",
        "com.engineering-os.milestone-two",
        "Filesystem MCP",
        "stdio",
        JSON.stringify({
          command: "node",
          args: ["./index.js"]
        }),
        1,
        "registered",
        timestamp
      ]
    );

    database.execute(
      `
        INSERT INTO mcp_capabilities (
          id,
          server_id,
          capability_type,
          capability_name,
          descriptor_json,
          descriptor_hash,
          discovered_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "capability-1",
        "mcp-server-1",
        "tool",
        "read_file",
        JSON.stringify({ name: "read_file" }),
        "hash-read-file",
        timestamp
      ]
    );

    database.execute(
      `
        INSERT INTO execution_audit (
          id,
          execution_id,
          plugin_id,
          server_id,
          capability_name,
          risk_level,
          request_summary,
          result_status,
          started_at,
          completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        "execution-audit-1",
        "execution-1",
        "com.engineering-os.milestone-two",
        "filesystem",
        "read_file",
        "read-only",
        JSON.stringify({ path: "[REDACTED]" }),
        "success",
        timestamp,
        timestamp
      ]
    );

    expect(
      database.queryFirst(
        "SELECT key, value_json FROM plugin_settings WHERE plugin_id = ?",
        ["com.engineering-os.milestone-two"]
      )
    ).toEqual({
      key: "theme",
      value_json: JSON.stringify("dark")
    });

    expect(
      database.queryFirst(
        "SELECT execution_id, request_summary FROM execution_audit WHERE id = ?",
        ["execution-audit-1"]
      )
    ).toEqual({
      execution_id: "execution-1",
      request_summary: JSON.stringify({ path: "[REDACTED]" })
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
