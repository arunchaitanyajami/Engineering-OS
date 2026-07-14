import { invoke } from "@tauri-apps/api/core";

import type {
  DesktopPlatform,
  EngineeringSession,
  LocalServicesStatus,
  OperatingSystem,
  PersistedLogEntry,
  PlatformInfo
} from "@engineering-os/platform";

interface TauriPlatformInfoResponse {
  readonly operatingSystem: OperatingSystem;
  readonly family: string;
  readonly arch: string;
  readonly appDataDirectory: string;
  readonly isDevelopment: boolean;
}

const BROWSER_CONFIG_KEY = "engineering-os.application-config";
const BROWSER_SESSION_KEY = "engineering-os.sessions";

const isTauriEnvironment = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const inferOperatingSystem = (): OperatingSystem => {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes("mac")) {
    return "macos";
  }

  if (userAgent.includes("win")) {
    return "windows";
  }

  if (userAgent.includes("linux")) {
    return "linux";
  }

  return "unknown";
};

const createBrowserFallbackInfo = (): PlatformInfo => ({
  operatingSystem: inferOperatingSystem(),
  family: "browser",
  arch: "unknown",
  appDataDirectory: "browser-local-storage",
  isDevelopment: import.meta.env.DEV,
  isTauri: false
});

export class TauriDesktopPlatform implements DesktopPlatform {
  async getAppVersion(): Promise<string> {
    if (!isTauriEnvironment()) {
      return "0.1.0-dev";
    }

    return invoke<string>("get_app_version");
  }

  async getPlatformInfo(): Promise<PlatformInfo> {
    if (!isTauriEnvironment()) {
      return createBrowserFallbackInfo();
    }

    const response =
      await invoke<TauriPlatformInfoResponse>("get_platform_info");

    return {
      ...response,
      isTauri: true
    };
  }

  async initializeLocalServices(): Promise<LocalServicesStatus> {
    if (!isTauriEnvironment()) {
      return {
        database: {
          ok: true,
          migrationVersion: 0,
          databasePath: "browser-memory"
        },
        logFilePath: "console-only",
        configFilePath: "browser-local-storage"
      };
    }

    return invoke<LocalServicesStatus>("initialize_local_services");
  }

  async loadPersistedConfig(): Promise<string | null> {
    if (!isTauriEnvironment()) {
      return window.localStorage.getItem(BROWSER_CONFIG_KEY);
    }

    return invoke<string | null>("load_persisted_config");
  }

  async savePersistedConfig(serializedConfig: string): Promise<void> {
    if (!isTauriEnvironment()) {
      window.localStorage.setItem(BROWSER_CONFIG_KEY, serializedConfig);
      return;
    }

    await invoke("save_persisted_config", { serializedConfig });
  }

  async listSessions(): Promise<readonly EngineeringSession[]> {
    if (!isTauriEnvironment()) {
      const serializedSessions =
        window.localStorage.getItem(BROWSER_SESSION_KEY);
      return serializedSessions
        ? (JSON.parse(serializedSessions) as readonly EngineeringSession[])
        : [];
    }

    return invoke<readonly EngineeringSession[]>("list_sessions");
  }

  async createSession(
    session: EngineeringSession
  ): Promise<EngineeringSession> {
    if (!isTauriEnvironment()) {
      const currentSessions = await this.listSessions();
      window.localStorage.setItem(
        BROWSER_SESSION_KEY,
        JSON.stringify([session, ...currentSessions])
      );
      return session;
    }

    return invoke<EngineeringSession>("create_session", { session });
  }

  async writeLogEntry(entry: PersistedLogEntry): Promise<void> {
    if (!isTauriEnvironment()) {
      return;
    }

    await invoke("write_log_entry", { entry });
  }

  async openExternalUrl(url: string): Promise<void> {
    if (!isTauriEnvironment()) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    await invoke("open_external_url", { url });
  }
}
