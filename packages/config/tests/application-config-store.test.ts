import { describe, expect, it } from "vitest";

import {
  ApplicationConfigStore,
  migratePersistedApplicationConfig,
  resolveThemeMode
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

  it("persists settings updates", async () => {
    const store = new ApplicationConfigStore(new InMemoryConfigStorage());
    const config = await store.updateSettings({
      telemetryEnabled: true
    });

    expect(config.settings.telemetryEnabled).toBe(true);
  });

  it("resolves theme preference against system mode", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("light", true)).toBe("light");
  });
});
