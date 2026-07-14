export type OperatingSystem =
  "macos" | "windows" | "linux" | "android" | "ios" | "unknown";

export interface PlatformInfo {
  readonly operatingSystem: OperatingSystem;
  readonly family: string;
  readonly arch: string;
  readonly appDataDirectory: string;
  readonly isDevelopment: boolean;
  readonly isTauri: boolean;
}

export interface ReadyDatabaseStatus {
  readonly ok: true;
  readonly status: "ready";
  readonly migrationVersion: number;
  readonly databasePath: string;
}

export interface UnavailableDatabaseStatus {
  readonly ok: false;
  readonly status: "unavailable";
  readonly reason: string;
  readonly migrationVersion: null;
  readonly databasePath: string;
}

export type DatabaseStatus = ReadyDatabaseStatus | UnavailableDatabaseStatus;

export interface LocalServicesStatus {
  readonly database: DatabaseStatus;
  readonly logFilePath: string;
  readonly configFilePath: string;
}

export interface EngineeringSession {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "active" | "archived";
}

export interface PersistedLogEntry {
  readonly timestamp: string;
  readonly level: "trace" | "debug" | "info" | "warn" | "error";
  readonly scope: string;
  readonly message: string;
  readonly context?: Record<string, unknown>;
  readonly correlationId?: string;
}

export interface DesktopPlatform {
  getAppVersion(): Promise<string>;
  getPlatformInfo(): Promise<PlatformInfo>;
  initializeLocalServices(): Promise<LocalServicesStatus>;
  loadPersistedConfig(): Promise<string | null>;
  savePersistedConfig(serializedConfig: string): Promise<void>;
  listSessions(): Promise<readonly EngineeringSession[]>;
  createSession(session: EngineeringSession): Promise<EngineeringSession>;
  writeLogEntry(entry: PersistedLogEntry): Promise<void>;
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
  persistedConfig: string | null = null;
  readonly sessions: EngineeringSession[] = [];
  readonly logEntries: PersistedLogEntry[] = [];

  async getAppVersion(): Promise<string> {
    return this.version;
  }

  async getPlatformInfo(): Promise<PlatformInfo> {
    return this.platformInfo;
  }

  async initializeLocalServices(): Promise<LocalServicesStatus> {
    return {
      database: {
        ok: true,
        status: "ready",
        migrationVersion: 2,
        databasePath: "/mock/engineering-os/app.sqlite"
      },
      logFilePath: "/mock/engineering-os/logs/application.log",
      configFilePath: "/mock/engineering-os/config/application-config.json"
    };
  }

  async loadPersistedConfig(): Promise<string | null> {
    return this.persistedConfig;
  }

  async savePersistedConfig(serializedConfig: string): Promise<void> {
    this.persistedConfig = serializedConfig;
  }

  async listSessions(): Promise<readonly EngineeringSession[]> {
    return this.sessions;
  }

  async createSession(
    session: EngineeringSession
  ): Promise<EngineeringSession> {
    this.sessions.unshift(session);
    return session;
  }

  async writeLogEntry(entry: PersistedLogEntry): Promise<void> {
    this.logEntries.push(entry);
  }

  async openExternalUrl(url: string): Promise<void> {
    this.openedUrls.push(url);
  }
}
