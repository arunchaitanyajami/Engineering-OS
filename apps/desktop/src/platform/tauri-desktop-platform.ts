import { invoke } from "@tauri-apps/api/core";

import type {
  DesktopPlatform,
  EngineeringSession,
  LocalServicesStatus,
  OperatingSystem,
  PersistedLogEntry,
  PlatformInfo
} from "@engineering-os/platform";

import {
  isTauriEnvironment,
  requestDesktopBackend
} from "../services/desktop-backend-request.js";

interface TauriPlatformInfoResponse {
  readonly operatingSystem: OperatingSystem;
  readonly family: string;
  readonly arch: string;
  readonly appDataDirectory: string;
  readonly isDevelopment: boolean;
}

const BROWSER_CONFIG_KEY = "engineering-os.application-config";
const BROWSER_SESSION_KEY = "engineering-os.sessions";

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
      return "0.2.0-dev";
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
          ok: false,
          status: "unavailable",
          reason: "non-tauri-environment",
          migrationVersion: null,
          databasePath: "browser-memory"
        },
        logFilePath: "unavailable-outside-tauri",
        configFilePath: "browser-local-storage"
      };
    }

    return requestDesktopBackend<LocalServicesStatus>("/health");
  }

  async loadPersistedConfig(): Promise<string | null> {
    if (!isTauriEnvironment()) {
      return window.localStorage.getItem(BROWSER_CONFIG_KEY);
    }

    const response = await requestDesktopBackend<{
      readonly serializedConfig: string | null;
    }>("/config");

    return response.serializedConfig;
  }

  async savePersistedConfig(serializedConfig: string): Promise<void> {
    if (!isTauriEnvironment()) {
      window.localStorage.setItem(BROWSER_CONFIG_KEY, serializedConfig);
      return;
    }

    await requestDesktopBackend<{ readonly ok: boolean }>("/config", {
      method: "PUT",
      body: JSON.stringify({ serializedConfig })
    });
  }

  async listSessions(): Promise<readonly EngineeringSession[]> {
    if (!isTauriEnvironment()) {
      const serializedSessions =
        window.localStorage.getItem(BROWSER_SESSION_KEY);
      return serializedSessions
        ? (JSON.parse(serializedSessions) as readonly EngineeringSession[])
        : [];
    }

    const response = await requestDesktopBackend<{
      readonly sessions: readonly EngineeringSession[];
    }>("/sessions");

    return response.sessions;
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

    const response = await requestDesktopBackend<{
      readonly session: EngineeringSession;
    }>("/sessions", {
      method: "POST",
      body: JSON.stringify({ session })
    });

    return response.session;
  }

  async writeLogEntry(entry: PersistedLogEntry): Promise<void> {
    if (!isTauriEnvironment()) {
      return;
    }

    await requestDesktopBackend<{ readonly ok: boolean }>("/logs", {
      method: "POST",
      body: JSON.stringify({ entry })
    });
  }

  async openExternalUrl(url: string): Promise<void> {
    if (!isTauriEnvironment()) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    await invoke("open_external_url", { url });
  }
}
