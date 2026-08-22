import type { SecretStore } from "@engineering-os/contracts/unstable-runtime";

export type SecretAuditAction =
  | "secret.read"
  | "secret.write"
  | "secret.delete"
  | "secret.list";

export type SecretAuditOutcome = "success" | "failure";

export interface SecretAuditRecord {
  readonly action: SecretAuditAction;
  readonly namespace: string;
  readonly key?: string;
  readonly outcome: SecretAuditOutcome;
}

export interface SecretAuditLogger {
  record(input: SecretAuditRecord): void;
}

export class AuditingSecretStore implements SecretStore {
  constructor(
    private readonly store: SecretStore,
    private readonly audit: SecretAuditLogger
  ) {}

  async get(namespace: string, key: string): Promise<string | null> {
    try {
      const value = await this.store.get(namespace, key);
      this.audit.record({
        action: "secret.read",
        namespace,
        key,
        outcome: "success"
      });
      return value;
    } catch (error) {
      this.audit.record({
        action: "secret.read",
        namespace,
        key,
        outcome: "failure"
      });
      throw error;
    }
  }

  async set(namespace: string, key: string, value: string): Promise<void> {
    try {
      await this.store.set(namespace, key, value);
      this.audit.record({
        action: "secret.write",
        namespace,
        key,
        outcome: "success"
      });
    } catch (error) {
      this.audit.record({
        action: "secret.write",
        namespace,
        key,
        outcome: "failure"
      });
      throw error;
    }
  }

  async delete(namespace: string, key: string): Promise<void> {
    try {
      await this.store.delete(namespace, key);
      this.audit.record({
        action: "secret.delete",
        namespace,
        key,
        outcome: "success"
      });
    } catch (error) {
      this.audit.record({
        action: "secret.delete",
        namespace,
        key,
        outcome: "failure"
      });
      throw error;
    }
  }

  async listKeys(namespace: string): Promise<string[]> {
    try {
      const keys = await this.store.listKeys(namespace);
      this.audit.record({
        action: "secret.list",
        namespace,
        outcome: "success"
      });
      return keys;
    } catch (error) {
      this.audit.record({
        action: "secret.list",
        namespace,
        outcome: "failure"
      });
      throw error;
    }
  }
}
