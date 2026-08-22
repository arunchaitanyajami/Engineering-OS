import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EncryptedFileSecretStore, SecretService } from "@engineering-os/security/server";

describe("EncryptedFileSecretStore", () => {
  it("stores and retrieves encrypted secret values by namespace", async () => {
    const secretsDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-secrets-")
    );

    try {
      const store = await EncryptedFileSecretStore.open(secretsDirectory);
      const service = new SecretService(store);

      await service.set("com.engineering-os.example", "api-token", "secret-value");

      await expect(
        service.get("com.engineering-os.example", "api-token")
      ).resolves.toBe("secret-value");
      await expect(
        service.get("com.engineering-os.example", "missing")
      ).resolves.toBeNull();
      await expect(
        service.listKeys("com.engineering-os.example")
      ).resolves.toEqual(["api-token"]);

      await service.delete("com.engineering-os.example", "api-token");

      await expect(
        service.get("com.engineering-os.example", "api-token")
      ).resolves.toBeNull();
    } finally {
      await rm(secretsDirectory, { recursive: true, force: true });
    }
  });

  it("persists secrets across store reopens", async () => {
    const secretsDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-secrets-")
    );

    try {
      const initialStore = await EncryptedFileSecretStore.open(secretsDirectory);
      await initialStore.set("system", "token", "persisted");

      const reopenedStore = await EncryptedFileSecretStore.open(secretsDirectory);

      await expect(reopenedStore.get("system", "token")).resolves.toBe(
        "persisted"
      );
    } finally {
      await rm(secretsDirectory, { recursive: true, force: true });
    }
  });
});
