import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SecretStore } from "@engineering-os/contracts/unstable-runtime";
import {
  AuditingSecretStore,
  EncryptedFileSecretStore,
  LayeredSecretStore,
  SecretService,
  UnavailablePlatformSecretStore,
  type PlatformSecretStore
} from "@engineering-os/security/server";

class MemoryPlatformSecretStore implements PlatformSecretStore {
  private readonly values = new Map<string, string>();

  private storageKey(namespace: string, key: string): string {
    return `${namespace}/${key}`;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async get(namespace: string, key: string): Promise<string | null> {
    return this.values.get(this.storageKey(namespace, key)) ?? null;
  }

  async set(namespace: string, key: string, value: string): Promise<void> {
    this.values.set(this.storageKey(namespace, key), value);
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.values.delete(this.storageKey(namespace, key));
  }

  async listKeys(namespace: string): Promise<string[]> {
    const prefix = `${namespace}/`;

    return [...this.values.keys()]
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => entry.slice(prefix.length))
      .sort();
  }
}

describe("LayeredSecretStore", () => {
  it("prefers platform storage when available", async () => {
    const platform = new MemoryPlatformSecretStore();
    const fallback: SecretStore = {
      async get() {
        return "fallback-value";
      },
      async set() {},
      async delete() {},
      async listKeys() {
        return [];
      }
    };

    const store = new SecretService(new LayeredSecretStore(platform, fallback));

    await store.set("system", "token", "platform-value");

    await expect(store.get("system", "token")).resolves.toBe("platform-value");
  });

  it("falls back to encrypted local storage when platform storage is unavailable", async () => {
    const secretsDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-layered-secrets-")
    );

    try {
      const fallback = await EncryptedFileSecretStore.open(secretsDirectory);
      const store = new SecretService(
        new LayeredSecretStore(new UnavailablePlatformSecretStore(), fallback)
      );

      await store.set("com.engineering-os.example", "token", "encrypted-value");

      await expect(
        store.get("com.engineering-os.example", "token")
      ).resolves.toBe("encrypted-value");
    } finally {
      await rm(secretsDirectory, { recursive: true, force: true });
    }
  });
});

describe("AuditingSecretStore", () => {
  it("records secret access metadata without secret values", async () => {
    const auditEvents: Array<Record<string, unknown>> = [];
    const inner: SecretStore = {
      async get(_namespace, key) {
        return key === "token" ? "secret-value" : null;
      },
      async set() {},
      async delete() {},
      async listKeys() {
        return ["token"];
      }
    };

    const store = new SecretService(
      new AuditingSecretStore(inner, {
        record: (input) => {
          auditEvents.push({ ...input });
        }
      })
    );

    await expect(
      store.get("com.engineering-os.example", "token")
    ).resolves.toBe("secret-value");
    await store.listKeys("com.engineering-os.example");

    expect(auditEvents).toEqual([
      {
        action: "secret.read",
        namespace: "com.engineering-os.example",
        key: "token",
        outcome: "success"
      },
      {
        action: "secret.list",
        namespace: "com.engineering-os.example",
        outcome: "success"
      }
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain("secret-value");
  });
});
