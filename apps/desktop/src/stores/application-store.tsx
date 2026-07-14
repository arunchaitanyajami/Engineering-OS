import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";

import {
  ApplicationConfigStore,
  defaultPersistedApplicationConfig,
  resolveThemeMode,
  type ApplicationSettings,
  type PersistedApplicationConfig
} from "@engineering-os/config";
import { createLogger, type Logger } from "@engineering-os/logger";
import type {
  DatabaseStatus,
  DesktopPlatform,
  EngineeringSession,
  LocalServicesStatus,
  PlatformInfo
} from "@engineering-os/platform";

import {
  normalizeApplicationError,
  type ApplicationError
} from "../services/application-errors";

export type ApplicationInitializationState =
  | { status: "booting" }
  | { status: "loading-configuration" }
  | { status: "initializing-platform" }
  | { status: "checking-local-services" }
  | { status: "ready" }
  | {
      status: "failed";
      error: ApplicationError;
    };

export interface StatusEntry {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone: "neutral" | "success" | "warning" | "error";
}

interface ApplicationStoreState {
  readonly initializationState: ApplicationInitializationState;
  readonly config: PersistedApplicationConfig;
  readonly platformInfo: PlatformInfo | null;
  readonly localServicesStatus: LocalServicesStatus | null;
  readonly appVersion: string;
  readonly sessions: readonly EngineeringSession[];
  readonly isCommandPaletteOpen: boolean;
  readonly resolvedTheme: "light" | "dark";
}

interface ApplicationStoreActions {
  retryInitialization(): void;
  setCommandPaletteOpen(isOpen: boolean): void;
  updateSettings(
    partialSettings: Partial<ApplicationSettings>
  ): Promise<PersistedApplicationConfig>;
  createSession(title?: string): Promise<EngineeringSession>;
}

const ApplicationStateContext = createContext<ApplicationStoreState | null>(
  null
);
const ApplicationActionsContext = createContext<ApplicationStoreActions | null>(
  null
);

const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

const nextSessionTitle = (sessions: readonly EngineeringSession[]): string =>
  `Session ${sessions.length + 1}`;

const createSessionId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `session-${Date.now()}`;
};

const getSystemPrefersDark = (): boolean => {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return true;
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches;
};

const applyTheme = (theme: "light" | "dark") => {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
};

const subscribeToSystemThemeChanges = (
  onChange: (prefersDark: boolean) => void
): (() => void) => {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => undefined;
  }

  const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
  const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
    onChange(event.matches);
  };

  if ("addEventListener" in mediaQuery) {
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }

  const legacyMediaQuery = mediaQuery as MediaQueryList & {
    addListener(listener: (event: MediaQueryListEvent) => void): void;
    removeListener(listener: (event: MediaQueryListEvent) => void): void;
  };

  legacyMediaQuery.addListener(handleChange);
  return () => legacyMediaQuery.removeListener(handleChange);
};

const getDatabaseSummary = (
  databaseStatus: DatabaseStatus | undefined
): Pick<StatusEntry, "value" | "tone"> => {
  if (!databaseStatus) {
    return {
      value: "Bootstrap pending",
      tone: "warning"
    };
  }

  if (databaseStatus.status === "ready") {
    return {
      value: `Ready (v${databaseStatus.migrationVersion})`,
      tone: "success"
    };
  }

  return {
    value: "Unavailable outside Tauri",
    tone: "warning"
  };
};

export const buildStatusEntries = (
  state: Pick<
    ApplicationStoreState,
    "appVersion" | "platformInfo" | "localServicesStatus"
  >
): readonly StatusEntry[] => {
  const databaseSummary = getDatabaseSummary(
    state.localServicesStatus?.database
  );

  return [
    {
      id: "version",
      label: "Version",
      value: state.appVersion,
      tone: "neutral"
    },
    {
      id: "mode",
      label: "Mode",
      value: "Local-first",
      tone: "success"
    },
    {
      id: "database",
      label: "Database",
      value: databaseSummary.value,
      tone: databaseSummary.tone
    },
    {
      id: "mcp",
      label: "MCP",
      value: "Future milestone",
      tone: "neutral"
    },
    {
      id: "provider",
      label: "AI",
      value: "Not configured",
      tone: "neutral"
    },
    {
      id: "platform",
      label: "Platform",
      value: state.platformInfo
        ? `${state.platformInfo.operatingSystem}/${state.platformInfo.arch}`
        : "Loading",
      tone: state.platformInfo ? "success" : "warning"
    }
  ];
};

export function ApplicationStoreProvider({
  configStore,
  logger = createLogger({ component: "desktop-app" }),
  platform,
  children
}: PropsWithChildren<{
  readonly configStore: ApplicationConfigStore;
  readonly logger?: Logger;
  readonly platform: DesktopPlatform;
}>) {
  const [initializationState, setInitializationState] =
    useState<ApplicationInitializationState>({
      status: "booting"
    });
  const [config, setConfig] = useState<PersistedApplicationConfig>(
    defaultPersistedApplicationConfig
  );
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [localServicesStatus, setLocalServicesStatus] =
    useState<LocalServicesStatus | null>(null);
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [sessions, setSessions] = useState<readonly EngineeringSession[]>([]);
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [bootstrapCounter, setBootstrapCounter] = useState(0);
  const [systemPrefersDark, setSystemPrefersDark] =
    useState(getSystemPrefersDark);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        setInitializationState({ status: "loading-configuration" });
        logger.info("Loading application configuration.");
        const loadedConfig = await configStore.load();

        if (cancelled) {
          return;
        }

        setConfig(loadedConfig);

        setInitializationState({ status: "initializing-platform" });
        logger.info("Initializing platform bridge.");
        const [version, resolvedPlatformInfo] = await Promise.all([
          platform.getAppVersion(),
          platform.getPlatformInfo()
        ]);

        if (cancelled) {
          return;
        }

        setAppVersion(version);
        setPlatformInfo(resolvedPlatformInfo);

        setInitializationState({ status: "checking-local-services" });
        logger.info("Checking local services.");
        const resolvedLocalServices = await platform.initializeLocalServices();

        if (cancelled) {
          return;
        }

        const storedSessions = await platform.listSessions();

        if (cancelled) {
          return;
        }

        setLocalServicesStatus(resolvedLocalServices);
        setSessions(storedSessions);

        setInitializationState({ status: "ready" });
      } catch (error) {
        if (cancelled) {
          return;
        }

        logger.error("Application initialization failed.", error);
        setInitializationState({
          status: "failed",
          error: normalizeApplicationError(error, {
            code: "APPLICATION_INITIALIZATION_FAILED",
            userMessage:
              "Engineering OS could not finish desktop initialization.",
            recoverable: true
          })
        });
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [bootstrapCounter, configStore, logger, platform]);

  useEffect(() => {
    if (config.settings.theme !== "system") {
      return undefined;
    }

    return subscribeToSystemThemeChanges(setSystemPrefersDark);
  }, [config.settings.theme]);

  useEffect(() => {
    applyTheme(resolveThemeMode(config.settings.theme, systemPrefersDark));
  }, [config.settings.theme, systemPrefersDark]);

  const retryInitialization = useCallback(() => {
    setBootstrapCounter((value) => value + 1);
  }, []);

  const updateSettings = useCallback(
    async (partialSettings: Partial<ApplicationSettings>) => {
      logger.info("Updating application settings.", {
        settingKeys: Object.keys(partialSettings)
      });
      const nextConfig = await configStore.updateSettings(partialSettings);
      setConfig(nextConfig);
      return nextConfig;
    },
    [configStore, logger]
  );

  const createSession = useCallback(
    async (title?: string) => {
      const timestamp = new Date().toISOString();
      const session: EngineeringSession = {
        id: createSessionId(),
        title: title?.trim() || nextSessionTitle(sessions),
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "active"
      };

      const persistedSession = await platform.createSession(session);
      setSessions((currentSessions) => [persistedSession, ...currentSessions]);
      logger.info("Created local session shell.", { sessionId: session.id });

      return persistedSession;
    },
    [logger, platform, sessions]
  );

  const resolvedTheme = useMemo(
    () => resolveThemeMode(config.settings.theme, systemPrefersDark),
    [config.settings.theme, systemPrefersDark]
  );

  const state = useMemo<ApplicationStoreState>(
    () => ({
      initializationState,
      config,
      platformInfo,
      localServicesStatus,
      appVersion,
      sessions,
      isCommandPaletteOpen,
      resolvedTheme
    }),
    [
      appVersion,
      config,
      initializationState,
      isCommandPaletteOpen,
      localServicesStatus,
      platformInfo,
      resolvedTheme,
      sessions
    ]
  );

  const actions = useMemo<ApplicationStoreActions>(
    () => ({
      retryInitialization,
      setCommandPaletteOpen,
      updateSettings,
      createSession
    }),
    [createSession, retryInitialization, updateSettings]
  );

  return (
    <ApplicationStateContext.Provider value={state}>
      <ApplicationActionsContext.Provider value={actions}>
        {children}
      </ApplicationActionsContext.Provider>
    </ApplicationStateContext.Provider>
  );
}

export const useApplicationState = (): ApplicationStoreState => {
  const value = useContext(ApplicationStateContext);

  if (!value) {
    throw new Error("Application state is unavailable.");
  }

  return value;
};

export const useApplicationActions = (): ApplicationStoreActions => {
  const value = useContext(ApplicationActionsContext);

  if (!value) {
    throw new Error("Application actions are unavailable.");
  }

  return value;
};
