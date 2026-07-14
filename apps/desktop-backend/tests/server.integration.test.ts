import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createBackendContext,
  startDesktopBackendServer,
  type StartedDesktopBackendServer
} from "../src/server.js";

describe("desktop backend server", () => {
  let appDataDirectory: string;
  let runtime: StartedDesktopBackendServer | null = null;

  beforeEach(async () => {
    appDataDirectory = await mkdtemp(join(tmpdir(), "engineering-os-backend-"));
  });

  afterEach(async () => {
    if (runtime) {
      await runtime.close();
      runtime = null;
    }

    await rm(appDataDirectory, { recursive: true, force: true });
  });

  it("initializes local services through the native backend runtime", async () => {
    runtime = await startDesktopBackendServer({
      appDataDirectory,
      host: "127.0.0.1",
      port: 0
    });

    const response = await fetch(`${runtime.baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      database: {
        ok: true,
        status: "ready",
        migrationVersion: 2,
        databasePath: runtime.context.databaseFilePath
      },
      configFilePath: runtime.context.configFilePath,
      logFilePath: runtime.context.logFilePath
    });
  });

  it("persists configuration updates atomically and preserves the prior version", async () => {
    runtime = await startDesktopBackendServer({
      appDataDirectory,
      host: "127.0.0.1",
      port: 0
    });

    const originalConfig = JSON.stringify({
      schemaVersion: 1,
      settings: {
        theme: "light",
        telemetryEnabled: false,
        autoUpdateEnabled: true,
        minimizeToTray: false,
        launchOnStartup: false,
        developerMode: false
      }
    });
    const updatedConfig = JSON.stringify({
      schemaVersion: 1,
      settings: {
        theme: "dark",
        telemetryEnabled: true,
        autoUpdateEnabled: true,
        minimizeToTray: false,
        launchOnStartup: false,
        developerMode: true
      }
    });

    await fetch(`${runtime.baseUrl}/config`, {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ serializedConfig: originalConfig })
    });
    await fetch(`${runtime.baseUrl}/config`, {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ serializedConfig: updatedConfig })
    });

    const response = await fetch(`${runtime.baseUrl}/config`);
    const body = (await response.json()) as {
      readonly serializedConfig: string | null;
    };

    expect(body.serializedConfig).toBe(updatedConfig);
    await expect(
      readFile(runtime.context.configFilePath, "utf8")
    ).resolves.toBe(updatedConfig);
    await expect(
      readFile(`${runtime.context.configFilePath}.bak`, "utf8")
    ).resolves.toBe(originalConfig);
  });

  it("round-trips sessions through the SQLite-backed HTTP contract", async () => {
    runtime = await startDesktopBackendServer({
      appDataDirectory,
      host: "127.0.0.1",
      port: 0
    });

    const session = {
      id: "session-1",
      title: "Desktop Review",
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
      status: "active" as const
    };

    const createResponse = await fetch(`${runtime.baseUrl}/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ session })
    });

    expect(createResponse.status).toBe(200);
    await expect(createResponse.json()).resolves.toEqual({ session });

    const listResponse = await fetch(`${runtime.baseUrl}/sessions`);

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      sessions: [session]
    });
  });

  it("writes persisted log entries to the local log file", async () => {
    runtime = await startDesktopBackendServer({
      appDataDirectory,
      host: "127.0.0.1",
      port: 0
    });

    const entry = {
      timestamp: "2026-07-14T00:00:00.000Z",
      level: "info" as const,
      scope: "desktop-shell",
      message: "Desktop backend integration test.",
      context: {
        area: "native-integration"
      }
    };

    const response = await fetch(`${runtime.baseUrl}/logs`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ entry })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    await expect(
      readFile(runtime.context.logFilePath, "utf8")
    ).resolves.toContain('"scope":"desktop-shell"');
  });

  it("allows loopback browser origins to call the desktop backend", async () => {
    runtime = await startDesktopBackendServer({
      appDataDirectory,
      host: "127.0.0.1",
      port: 0
    });

    const response = await fetch(`${runtime.baseUrl}/health`, {
      headers: {
        origin: "http://127.0.0.1:1420"
      }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:1420"
    );
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "OPTIONS"
    );
  });

  it("answers CORS preflight requests for allowed desktop origins", async () => {
    runtime = await startDesktopBackendServer({
      appDataDirectory,
      host: "127.0.0.1",
      port: 0
    });

    const response = await fetch(`${runtime.baseUrl}/config`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:1420",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type"
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:1420"
    );
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "content-type"
    );
  });

  it("runs migrations before exposing the backend context", async () => {
    const context = await createBackendContext(appDataDirectory);

    expect(context.database.getHealth()).toMatchObject({
      ok: true,
      migrationVersion: 2,
      databasePath: context.databaseFilePath
    });

    context.database.close();
  });
});
