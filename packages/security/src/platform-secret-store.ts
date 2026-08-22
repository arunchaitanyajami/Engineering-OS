import type { SecretStore } from "@engineering-os/contracts/unstable-runtime";

import { SecretServiceError } from "./errors.js";

export interface PlatformSecretStore extends SecretStore {
  isAvailable(): Promise<boolean>;
}

export class UnavailablePlatformSecretStore implements PlatformSecretStore {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async get(): Promise<string | null> {
    return null;
  }

  async set(): Promise<void> {
    throw new SecretServiceError(
      "PLATFORM_SECRET_STORE_UNAVAILABLE",
      "Platform secret storage is unavailable in this runtime.",
      501
    );
  }

  async delete(): Promise<void> {
    throw new SecretServiceError(
      "PLATFORM_SECRET_STORE_UNAVAILABLE",
      "Platform secret storage is unavailable in this runtime.",
      501
    );
  }

  async listKeys(): Promise<string[]> {
    return [];
  }
}
