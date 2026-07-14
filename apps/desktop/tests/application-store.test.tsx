import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApplicationConfigStore,
  defaultPersistedApplicationConfig
} from "@engineering-os/config";
import {
  createLogger,
  type LogEntry,
  type LogTransport
} from "@engineering-os/logger";
import type {
  DesktopPlatform,
  EngineeringSession,
  LocalServicesStatus,
  PersistedLogEntry,
  PlatformInfo
} from "@engineering-os/platform";

import {
  ApplicationStoreProvider,
  useApplicationState
} from "../src/stores/application-store";

class InMemoryConfigStorage {
  constructor(private readonly serializedConfig: string | null = null) {}

  async load(): Promise<string | null> {
    return this.serializedConfig;
  }

  async save(): Promise<void> {}
}

class NoopTransport implements LogTransport {
  write(_entry: LogEntry): void {}
}

const createLoggerForTests = () =>
  createLogger({
    component: "application-store-test",
    transport: new NoopTransport()
  });

const createPlatformInfo = (): PlatformInfo => ({
  operatingSystem: "macos",
  family: "unix",
  arch: "arm64",
  appDataDirectory: "/tmp/engineering-os",
  isDevelopment: true,
  isTauri: true
});

const createLocalServicesStatus = (): LocalServicesStatus => ({
  database: {
    ok: true,
    status: "ready",
    migrationVersion: 2,
    databasePath: "/tmp/engineering-os/app.sqlite"
  },
  logFilePath: "/tmp/engineering-os/application.log",
  configFilePath: "/tmp/engineering-os/application-config.json"
});

const createDesktopPlatform = (
  overrides: Partial<DesktopPlatform> = {}
): DesktopPlatform => ({
  getAppVersion: async () => "0.1.0",
  getPlatformInfo: async () => createPlatformInfo(),
  initializeLocalServices: async () => createLocalServicesStatus(),
  loadPersistedConfig: async () => null,
  savePersistedConfig: async () => undefined,
  listSessions: async () => [],
  createSession: async (session: EngineeringSession) => session,
  writeLogEntry: async (_entry: PersistedLogEntry) => undefined,
  openExternalUrl: async (_url: string) => undefined,
  ...overrides
});

function StoreHarness() {
  const { initializationState, resolvedTheme } = useApplicationState();

  return (
    <>
      <span data-testid="status">{initializationState.status}</span>
      <span data-testid="theme">{resolvedTheme}</span>
    </>
  );
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((pendingResolve) => {
    resolve = pendingResolve;
  });

  return {
    promise,
    resolve
  };
}

function createMatchMediaController(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const notifyListener = (
    listener: EventListenerOrEventListenerObject,
    event: MediaQueryListEvent
  ) => {
    if (typeof listener === "function") {
      listener(event);
      return;
    }

    listener.handleEvent(event);
  };

  const mediaQuery = {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (
      _event: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      listeners.add(listener);
    },
    removeEventListener: (
      _event: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      listeners.delete(listener);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener as EventListener);
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener as EventListener);
    },
    dispatchEvent: () => true,
    removeEventListenerLegacy: undefined,
    addEventListenerLegacy: undefined,
    dispatchChange(nextMatches: boolean) {
      matches = nextMatches;
      (mediaQuery as { matches: boolean }).matches = nextMatches;
      const event = {
        matches: nextMatches,
        media: "(prefers-color-scheme: dark)"
      } as MediaQueryListEvent;
      listeners.forEach((listener) => notifyListener(listener, event));
    }
  } as MediaQueryList & {
    dispatchChange(nextMatches: boolean): void;
  };

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => mediaQuery)
  });

  return mediaQuery;
}

describe("ApplicationStoreProvider", () => {
  afterEach(() => {
    cleanup();
  });

  it("initializes local services before listing sessions", async () => {
    const deferredServices = createDeferred<LocalServicesStatus>();
    let servicesInitialized = false;
    let listedBeforeInitialization = false;

    const platform = createDesktopPlatform({
      initializeLocalServices: vi.fn(async () => {
        const services = await deferredServices.promise;
        servicesInitialized = true;
        return services;
      }),
      listSessions: vi.fn(async () => {
        listedBeforeInitialization = !servicesInitialized;
        return [];
      })
    });

    render(
      <ApplicationStoreProvider
        configStore={new ApplicationConfigStore(new InMemoryConfigStorage())}
        logger={createLoggerForTests()}
        platform={platform}
      >
        <StoreHarness />
      </ApplicationStoreProvider>
    );

    await waitFor(() =>
      expect(platform.initializeLocalServices).toHaveBeenCalledTimes(1)
    );
    expect(platform.listSessions).not.toHaveBeenCalled();

    deferredServices.resolve(createLocalServicesStatus());

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("ready")
    );
    expect(listedBeforeInitialization).toBe(false);
    expect(platform.listSessions).toHaveBeenCalledTimes(1);
  });

  it("reacts to system theme changes when preference is system", async () => {
    const mediaQuery = createMatchMediaController(false);
    const platform = createDesktopPlatform();
    const configStore = new ApplicationConfigStore(
      new InMemoryConfigStorage(
        JSON.stringify({
          ...defaultPersistedApplicationConfig,
          settings: {
            ...defaultPersistedApplicationConfig.settings,
            theme: "system"
          }
        })
      )
    );

    render(
      <ApplicationStoreProvider
        configStore={configStore}
        logger={createLoggerForTests()}
        platform={platform}
      >
        <StoreHarness />
      </ApplicationStoreProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("ready")
    );
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "light")
    );

    mediaQuery.dispatchChange(true);

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });
});
