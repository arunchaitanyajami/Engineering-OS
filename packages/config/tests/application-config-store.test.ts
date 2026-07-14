import { describe, expect, it } from "vitest";

import {
  ApplicationConfigStore,
  InvalidPersistedConfigurationError,
  migratePersistedApplicationConfig,
  resolveThemeMode,
  UnsupportedConfigurationVersionError
} from "@engineering-os/config";

class InMemoryConfigStorage {
  constructor(private serializedConfig: string | null = null) {}

  async load(): Promise<string | null> {
    return this.serializedConfig;
  }

  async save(serializedConfig: string): Promise<void> {
    this.serializedConfig = serializedConfig;
  }
}

describe("ApplicationConfigStore", () => {
  it("migrates legacy settings objects", () => {
    expect(
      migratePersistedApplicationConfig({
        theme: "dark",
        developerMode: true
      })
    ).toMatchObject({
      schemaVersion: 1,
      settings: {
        theme: "dark",
        developerMode: true
      }
    });
  });

  it("migrates schema version 0 documents to the current version", () => {
    expect(
      migratePersistedApplicationConfig({
        schemaVersion: 0,
        settings: {
          theme: "dark",
          developerMode: true
        }
      })
    ).toMatchObject({
      schemaVersion: 1,
      settings: {
        theme: "dark",
        developerMode: true
      }
    });
  });

  it("rejects unknown future schema versions", () => {
    expect(() =>
      migratePersistedApplicationConfig({
        schemaVersion: 999,
        settings: {}
      })
    ).toThrowError(UnsupportedConfigurationVersionError);
  });

  it("persists settings updates", async () => {
    const store = new ApplicationConfigStore(new InMemoryConfigStorage());
    const config = await store.updateSettings({
      telemetryEnabled: true
    });

    expect(config.settings.telemetryEnabled).toBe(true);
  });

  it("throws when persisted configuration is malformed JSON", async () => {
    const store = new ApplicationConfigStore(new InMemoryConfigStorage("{"));

    await expect(store.load()).rejects.toThrowError(
      InvalidPersistedConfigurationError
    );
  });

  it("resolves theme preference against system mode", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("light", true)).toBe("light");
  });
});
