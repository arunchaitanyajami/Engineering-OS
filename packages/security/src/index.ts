export type {
  AuditEvent,
  AuditOutcome,
  PermissionGrant,
  PermissionGrantDecision,
  PermissionScope as Permission,
  PluginPermissionRequest as PermissionRequest,
  SecretReference,
  SecretStore
} from "@engineering-os/contracts";
export {
  REDACTED_VALUE,
  permissionScope as permission,
  permissionScopeSchema,
  permissionGrantDecisionSchema,
  permissionGrantSchema,
  pluginPermissionRequestSchema as permissionRequestSchema,
  redactKeys,
  secretReferenceSchema
} from "@engineering-os/contracts";

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
