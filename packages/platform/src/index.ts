export type OperatingSystem =
  | "macos"
  | "windows"
  | "linux"
  | "android"
  | "ios"
  | "unknown";

export interface PlatformInfo {
  readonly operatingSystem: OperatingSystem;
  readonly family: string;
  readonly arch: string;
  readonly appDataDirectory: string;
  readonly isDevelopment: boolean;
  readonly isTauri: boolean;
}

export interface DesktopPlatform {
  getAppVersion(): Promise<string>;
  getPlatformInfo(): Promise<PlatformInfo>;
  openExternalUrl(url: string): Promise<void>;
}

export class MockDesktopPlatform implements DesktopPlatform {
  constructor(
    private readonly version = "0.1.0",
    private readonly platformInfo: PlatformInfo = {
      operatingSystem: "macos",
      family: "unix",
      arch: "arm64",
      appDataDirectory: "/mock/engineering-os",
      isDevelopment: true,
      isTauri: false
    }
  ) {}

  readonly openedUrls: string[] = [];

  async getAppVersion(): Promise<string> {
    return this.version;
  }

  async getPlatformInfo(): Promise<PlatformInfo> {
    return this.platformInfo;
  }

  async openExternalUrl(url: string): Promise<void> {
    this.openedUrls.push(url);
  }
}
