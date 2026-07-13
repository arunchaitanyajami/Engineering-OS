import type { Brand } from "@engineering-os/shared";

export type Permission = Brand<string, "Permission">;

export const permission = (value: string): Permission => value as Permission;

export const permissions = {
  filesystemRead: permission("filesystem.read"),
  filesystemWrite: permission("filesystem.write"),
  networkRequest: permission("network.request"),
  databaseRead: permission("database.read"),
  databaseWrite: permission("database.write"),
  shellExecute: permission("shell.execute"),
  secretRead: permission("secret.read")
} as const;

export interface SecretReference {
  readonly namespace: string;
  readonly key: string;
}

export interface SecretStore {
  get(reference: SecretReference): Promise<string | null>;
  set(reference: SecretReference, value: string): Promise<void>;
  delete(reference: SecretReference): Promise<void>;
}

export type ConfirmationMode =
  "none" | "user-confirmation" | "dual-confirmation";

export interface ConfirmationPolicy {
  readonly mode: ConfirmationMode;
  readonly reason: string;
  readonly destructive: boolean;
}

export type AuditActorType =
  "user" | "agent" | "workflow" | "plugin" | "system";
export type AuditOutcome = "success" | "failure" | "denied";

export interface AuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly actorType: AuditActorType;
  readonly actorId?: string;
  readonly action: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly outcome: AuditOutcome;
  readonly correlationId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export const REDACTED_VALUE = "[REDACTED]";

export const redactKeys = [
  "authorization",
  "apiKey",
  "credential",
  "password",
  "secret",
  "token"
] as const;
