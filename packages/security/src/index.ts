export type {
  PermissionScope as Permission,
  PluginPermissionRequest as PermissionRequest
} from "@engineering-os/contracts";
export {
  permissionScope as permission,
  permissionScopeSchema,
  pluginPermissionRequestSchema as permissionRequestSchema
} from "@engineering-os/contracts";
export type {
  AuditEvent,
  AuditOutcome,
  PermissionGrant,
  PermissionGrantDecision,
  SecretStore,
  SystemSecretReference as SecretReference
} from "@engineering-os/contracts/unstable-runtime";
export {
  permissionGrantDecisionSchema,
  permissionGrantSchema,
  REDACTED_VALUE,
  redactKeys,
  systemSecretReferenceSchema as secretReferenceSchema
} from "@engineering-os/contracts/unstable-runtime";

import { permissionScope } from "@engineering-os/contracts";

export type ConfirmationMode =
  "none" | "user-confirmation" | "dual-confirmation";

export interface ConfirmationPolicy {
  readonly mode: ConfirmationMode;
  readonly reason: string;
  readonly destructive: boolean;
}

export const permissions = {
  filesystemRead: permissionScope("filesystem.read"),
  filesystemWrite: permissionScope("filesystem.write"),
  filesystemWatch: permissionScope("filesystem.watch"),
  networkAccess: permissionScope("network.access"),
  processSpawn: permissionScope("process.spawn"),
  secretsRead: permissionScope("secrets.read"),
  secretsWrite: permissionScope("secrets.write"),
  notificationsShow: permissionScope("notifications.show"),
  clipboardRead: permissionScope("clipboard.read"),
  clipboardWrite: permissionScope("clipboard.write"),
  externalUrlOpen: permissionScope("external-url.open"),
  mcpRegisterServer: permissionScope("mcp.register-server"),
  toolExecute: permissionScope("tool.execute"),
  workflowRegister: permissionScope("workflow.register"),
  agentRegister: permissionScope("agent.register"),
  uiRegisterView: permissionScope("ui.register-view")
} as const;
