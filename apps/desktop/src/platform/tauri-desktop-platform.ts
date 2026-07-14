import { invoke } from "@tauri-apps/api/core";

import type {
  DesktopPlatform,
  OperatingSystem,
  PlatformInfo
} from "@engineering-os/platform";

interface TauriPlatformInfoResponse {
  readonly operatingSystem: OperatingSystem;
  readonly family: string;
  readonly arch: string;
  readonly appDataDirectory: string;
  readonly isDevelopment: boolean;
}

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

    const response = await invoke<TauriPlatformInfoResponse>("get_platform_info");

    return {
      ...response,
      isTauri: true
    };
  }

  async openExternalUrl(url: string): Promise<void> {
    if (!isTauriEnvironment()) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    await invoke("open_external_url", { url });
  }
}
