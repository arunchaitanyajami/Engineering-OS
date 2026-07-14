import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

import { TauriDesktopPlatform } from "../src/platform/tauri-desktop-platform";

describe("TauriDesktopPlatform", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    vi.useRealTimers();
  });

  it("reports browser fallback services as unavailable outside Tauri", async () => {
    const platform = new TauriDesktopPlatform();

    await expect(platform.initializeLocalServices()).resolves.toMatchObject({
      database: {
        ok: false,
        status: "unavailable",
        reason: "non-tauri-environment",
        migrationVersion: null,
        databasePath: "browser-memory"
      },
      logFilePath: "unavailable-outside-tauri",
      configFilePath: "browser-local-storage"
    });
  });

  it("retries backend health checks during desktop startup races", async () => {
    vi.useFakeTimers();
    invokeMock.mockResolvedValue({
      baseUrl: "http://127.0.0.1:43110",
      authorizationToken: "test-token"
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true
    });

    let backendAttempt = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        backendAttempt += 1;

        if (backendAttempt === 1) {
          throw new TypeError("Failed to fetch");
        }

        expect(url).toBe("http://127.0.0.1:43110/health");
        expect(init?.headers).toMatchObject({
          authorization: "Bearer test-token",
          "content-type": "application/json"
        });

        return new Response(
          JSON.stringify({
            database: {
              ok: true,
              status: "ready",
              migrationVersion: 2,
              databasePath: "/tmp/engineering-os.sqlite"
            },
            logFilePath: "/tmp/application.log",
            configFilePath: "/tmp/application-config.json"
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const platform = new TauriDesktopPlatform();
    const initializationPromise = platform.initializeLocalServices();

    await vi.runAllTimersAsync();

    await expect(initializationPromise).resolves.toMatchObject({
      database: {
        ok: true,
        status: "ready",
        migrationVersion: 2
      }
    });
    expect(backendAttempt).toBe(2);
    expect(invokeMock).toHaveBeenCalledWith("get_backend_connection");
  });
});
