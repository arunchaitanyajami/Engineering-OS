import type { SecretStore } from "@engineering-os/contracts/unstable-runtime";

import {
  AuditingSecretStore,
  type SecretAuditLogger
} from "./auditing-secret-store.js";
import { EncryptedFileSecretStore } from "./encrypted-file-secret-store.js";
import { LayeredSecretStore } from "./layered-secret-store.js";
import {
  UnavailablePlatformSecretStore,
  type PlatformSecretStore
} from "./platform-secret-store.js";
import { SecretService } from "./secret-service.js";

export interface ApplicationSecretStoreOptions {
  readonly secretsDirectory: string;
  readonly platform?: PlatformSecretStore;
  readonly audit?: SecretAuditLogger;
}

const createStoreStack = async (
  options: ApplicationSecretStoreOptions
): Promise<SecretStore> => {
  const fallback = await EncryptedFileSecretStore.open(
    options.secretsDirectory
  );
  const platform = options.platform ?? new UnavailablePlatformSecretStore();
  const layered = new LayeredSecretStore(platform, fallback);

  if (!options.audit) {
    return layered;
  }

  return new AuditingSecretStore(layered, options.audit);
};

export const createApplicationSecretStore = async (
  options: ApplicationSecretStoreOptions
): Promise<SecretService> => new SecretService(await createStoreStack(options));
