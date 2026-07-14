import type { ConfigurationStorageAdapter } from "@engineering-os/config";

const CONFIG_STORAGE_KEY = "engineering-os.application-config";

export class BrowserConfigStorage implements ConfigurationStorageAdapter {
  async load(): Promise<string | null> {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem(CONFIG_STORAGE_KEY);
  }

  async save(serializedConfig: string): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(CONFIG_STORAGE_KEY, serializedConfig);
  }
}
