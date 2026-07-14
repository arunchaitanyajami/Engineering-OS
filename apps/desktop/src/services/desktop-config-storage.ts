import type { ConfigurationStorageAdapter } from "@engineering-os/config";
import type { DesktopPlatform } from "@engineering-os/platform";

export class DesktopConfigStorage implements ConfigurationStorageAdapter {
  constructor(private readonly platform: DesktopPlatform) {}

  async load(): Promise<string | null> {
    return this.platform.loadPersistedConfig();
  }

  async save(serializedConfig: string): Promise<void> {
    await this.platform.savePersistedConfig(serializedConfig);
  }
}
