import type { SecretStore } from "@engineering-os/contracts/unstable-runtime";

import {
  assertValidSecretKey,
  assertValidSecretNamespace
} from "./namespace.js";

export class SecretService implements SecretStore {
  constructor(private readonly store: SecretStore) {}

  get(namespace: string, key: string): Promise<string | null> {
    assertValidSecretNamespace(namespace);
    assertValidSecretKey(key);
    return this.store.get(namespace, key);
  }

  set(namespace: string, key: string, value: string): Promise<void> {
    assertValidSecretNamespace(namespace);
    assertValidSecretKey(key);
    return this.store.set(namespace, key, value);
  }

  delete(namespace: string, key: string): Promise<void> {
    assertValidSecretNamespace(namespace);
    assertValidSecretKey(key);
    return this.store.delete(namespace, key);
  }

  listKeys(namespace: string): Promise<string[]> {
    assertValidSecretNamespace(namespace);
    return this.store.listKeys(namespace);
  }
}
