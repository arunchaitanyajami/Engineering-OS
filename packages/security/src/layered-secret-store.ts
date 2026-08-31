import type { SecretStore } from "@engineering-os/contracts/unstable-runtime";

import type { PlatformSecretStore } from "./platform-secret-store.js";

export class LayeredSecretStore implements SecretStore {
  constructor(
    private readonly platform: PlatformSecretStore,
    private readonly fallback: SecretStore
  ) {}

  async get(namespace: string, key: string): Promise<string | null> {
    if (await this.platform.isAvailable()) {
      const platformValue = await this.platform.get(namespace, key);

      if (platformValue !== null) {
        return platformValue;
      }
    }

    return this.fallback.get(namespace, key);
  }

  async set(namespace: string, key: string, value: string): Promise<void> {
    if (await this.platform.isAvailable()) {
      await this.platform.set(namespace, key, value);
      return;
    }

    await this.fallback.set(namespace, key, value);
  }

  async delete(namespace: string, key: string): Promise<void> {
    if (await this.platform.isAvailable()) {
      try {
        await this.platform.delete(namespace, key);
      } catch {
        // Fall through so fallback copies are still removed.
      }
    }

    await this.fallback.delete(namespace, key);
  }

  async listKeys(namespace: string): Promise<string[]> {
    const keys = new Set<string>();

    if (await this.platform.isAvailable()) {
      for (const key of await this.platform.listKeys(namespace)) {
        keys.add(key);
      }
    }

    for (const key of await this.fallback.listKeys(namespace)) {
      keys.add(key);
    }

    return [...keys].sort();
  }
}
