import type { Brand } from "@engineering-os/shared";
import { z } from "zod";

import {
  commandTextSchema,
  displayNameSchema,
  genericPathSchema,
  identifierSchema,
  isoTimestampSchema,
  jsonObjectSchema,
  keySchema,
  permissionScopeSchema,
  pluginIdSchema,
  pluginManifestSchema
} from "./stable.js";
import type { PermissionScope, PluginId, PluginManifest } from "./stable.js";

export type McpServerId = Brand<string, "McpServerId">;
export type ToolId = Brand<string, "ToolId">;
export type ExecutionId = Brand<string, "ExecutionId">;
export type CorrelationId = Brand<string, "CorrelationId">;

export const mcpServerId = (value: string): McpServerId => value as McpServerId;
export const toolId = (value: string): ToolId => value as ToolId;
export const executionId = (value: string): ExecutionId => value as ExecutionId;
export const correlationId = (value: string): CorrelationId =>
  value as CorrelationId;

export const unstableContractsStage = "unstable-runtime";
export const pluginRuntimeProtocolVersion = "1";
export const pluginRuntimeProtocolVersionSchema = z.literal(
  pluginRuntimeProtocolVersion
);

export type PluginRuntimeProtocolVersion = z.infer<
  typeof pluginRuntimeProtocolVersionSchema
>;

export const pluginRuntimeStatusSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "stopping",
  "failed"
]);

export type PluginRuntimeStatus = z.infer<typeof pluginRuntimeStatusSchema>;

export const pluginStateSchema = z.enum([
  "discovered",
  "validated",
  "installed",
  "disabled",
  "starting",
  "running",
  "stopping",
  "failed",
  "incompatible",
  "removed"
]);

export type PluginState = z.infer<typeof pluginStateSchema>;

export const permissionGrantDecisionSchema = z.enum([
  "deny",
  "allow-once",
  "allow-for-session",
  "always-allow"
]);

export type PermissionGrantDecision = z.infer<
  typeof permissionGrantDecisionSchema
>;

export const permissionGrantSchema = z
  .object({
    pluginId: pluginIdSchema,
    scope: permissionScopeSchema,
    constraint: jsonObjectSchema.optional(),
    decision: permissionGrantDecisionSchema,
    grantedAt: isoTimestampSchema.optional(),
    revokedAt: isoTimestampSchema.optional()
  })
  .strict();

export type PermissionGrant = z.infer<typeof permissionGrantSchema>;

export const toolRiskLevelSchema = z.enum([
  "read-only",
  "write",
  "destructive",
  "privileged",
  "unknown"
]);

export type ToolRiskLevel = z.infer<typeof toolRiskLevelSchema>;

export const toolAnnotationsSchema = z
  .object({
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    title: z.string().min(1).optional()
  })
  .strict();

export type ToolAnnotations = z.infer<typeof toolAnnotationsSchema>;

export const executionActorSchema = z
  .object({
    type: z.enum(["user", "agent", "workflow", "plugin", "system"]),
    id: z.string().min(1).optional()
  })
  .strict();

export type ExecutionActor = z.infer<typeof executionActorSchema>;

export const executionContextSchema = z
  .object({
    actor: executionActorSchema,
    correlationId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    approvalMode: z
      .enum(["none", "user-confirmation", "dual-confirmation"])
      .default("none")
  })
  .strict();

export type ExecutionContext = z.infer<typeof executionContextSchema>;

export const toolDescriptorSchema = z
  .object({
    id: identifierSchema,
    serverId: identifierSchema,
    pluginId: pluginIdSchema.optional(),
    name: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    inputSchema: jsonObjectSchema,
    annotations: toolAnnotationsSchema.optional(),
    riskLevel: toolRiskLevelSchema.default("unknown")
  })
  .strict();

export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;

export const resourceDescriptorSchema = z
  .object({
    id: identifierSchema,
    serverId: identifierSchema,
    pluginId: pluginIdSchema.optional(),
    name: z.string().min(1),
    uri: z.string().min(1),
    description: z.string().min(1).optional()
  })
  .strict();

export type ResourceDescriptor = z.infer<typeof resourceDescriptorSchema>;

export const promptDescriptorSchema = z
  .object({
    id: identifierSchema,
    serverId: identifierSchema,
    pluginId: pluginIdSchema.optional(),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    argumentsSchema: jsonObjectSchema.optional()
  })
  .strict();

export type PromptDescriptor = z.infer<typeof promptDescriptorSchema>;

export const capabilityContentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: z.string()
    })
    .strict(),
  z
    .object({
      type: z.literal("json"),
      value: z.unknown()
    })
    .strict(),
  z
    .object({
      type: z.literal("resource-link"),
      uri: z.string().min(1),
      title: z.string().min(1).optional()
    })
    .strict()
]);

export type CapabilityContent = z.infer<typeof capabilityContentSchema>;

export const normalizedExecutionErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean().default(false),
    details: jsonObjectSchema.optional()
  })
  .strict();

export type NormalizedExecutionError = z.infer<
  typeof normalizedExecutionErrorSchema
>;

export const toolExecutionRequestSchema = z
  .object({
    toolId: identifierSchema,
    arguments: jsonObjectSchema,
    executionContext: executionContextSchema
  })
  .strict();

export type ToolExecutionRequest = z.infer<typeof toolExecutionRequestSchema>;

export const toolExecutionResultSchema = z
  .object({
    status: z.enum(["success", "error", "cancelled", "timeout"]),
    content: z.array(capabilityContentSchema).default([]),
    metadata: jsonObjectSchema.optional(),
    error: normalizedExecutionErrorSchema.optional()
  })
  .strict();

export type ToolExecutionResult = z.infer<typeof toolExecutionResultSchema>;

export const systemSecretReferenceSchema = z
  .object({
    namespace: z.string().trim().min(1).max(256),
    key: keySchema
  })
  .strict();

export type SystemSecretReference = z.infer<typeof systemSecretReferenceSchema>;

const systemEnvironmentValueSchema = z.union([
  commandTextSchema,
  systemSecretReferenceSchema
]);

export const stdioTransportConfigurationSchema = z
  .object({
    type: z.literal("stdio"),
    command: commandTextSchema,
    args: z.array(commandTextSchema).default([]),
    cwd: genericPathSchema.optional(),
    env: z.record(z.string(), systemEnvironmentValueSchema).optional()
  })
  .strict();

export const streamableHttpTransportConfigurationSchema = z
  .object({
    type: z.literal("streamable-http"),
    url: z.string().trim().url(),
    headers: z.record(z.string(), systemEnvironmentValueSchema).optional()
  })
  .strict();

export const mcpTransportConfigurationSchema = z.discriminatedUnion("type", [
  stdioTransportConfigurationSchema,
  streamableHttpTransportConfigurationSchema
]);

export type McpTransportConfiguration = z.infer<
  typeof mcpTransportConfigurationSchema
>;

export const mcpServerRegistrationSchema = z
  .object({
    id: identifierSchema,
    source: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("plugin"),
          pluginId: pluginIdSchema
        })
        .strict(),
      z
        .object({
          type: z.literal("user")
        })
        .strict(),
      z
        .object({
          type: z.literal("system")
        })
        .strict()
    ]),
    name: displayNameSchema,
    transport: mcpTransportConfigurationSchema,
    enabled: z.boolean(),
    environment: z.record(z.string(), systemEnvironmentValueSchema).optional(),
    timeoutMs: z.number().int().positive().max(300_000).optional()
  })
  .strict();

export type McpServerRegistration = z.infer<typeof mcpServerRegistrationSchema>;

export interface SecretStore {
  get(namespace: string, key: string): Promise<string | null>;
  set(namespace: string, key: string, value: string): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  listKeys(namespace: string): Promise<string[]>;
}

export interface PluginLogger {
  trace(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  debug(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  info(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  warn(message: string, metadata?: Readonly<Record<string, unknown>>): void;
  error(
    message: string,
    error?: unknown,
    metadata?: Readonly<Record<string, unknown>>
  ): void;
}

export interface PluginConfigurationApi {
  get<TValue>(key: string): Promise<TValue | null>;
  set<TValue>(key: string, value: TValue): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PluginStorageApi {
  get<TValue>(key: string): Promise<TValue | null>;
  set<TValue>(key: string, value: TValue): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(): Promise<string[]>;
}

export interface PluginPermissionApi {
  has(
    scope: PermissionScope,
    constraint?: Record<string, unknown>
  ): Promise<boolean>;
  request(
    scope: PermissionScope,
    reason: string,
    constraint?: Record<string, unknown>
  ): Promise<PermissionGrantDecision>;
}

export interface PluginEventApi {
  emit(topic: string, payload: Record<string, unknown>): Promise<void>;
  subscribe(
    topic: string,
    handler: (payload: Record<string, unknown>) => void | Promise<void>
  ): Promise<() => void>;
}

export interface PluginMcpApi {
  registerServer(registration: McpServerRegistration): Promise<void>;
  listTools(): Promise<readonly ToolDescriptor[]>;
  executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult>;
}

export interface PluginSecretsApi {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(): Promise<string[]>;
}

export interface EngineeringOsPluginContext {
  plugin: {
    id: PluginId;
    name: string;
    version: string;
  };
  logger: PluginLogger;
  configuration: PluginConfigurationApi;
  secrets: PluginSecretsApi;
  storage: PluginStorageApi;
  permissions: PluginPermissionApi;
  events: PluginEventApi;
  mcp: PluginMcpApi;
}

export interface EngineeringOsPlugin {
  readonly manifest: PluginManifest;
  initialize(context: EngineeringOsPluginContext): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  dispose(): Promise<void>;
}

export const rpcErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: jsonObjectSchema.optional()
  })
  .strict();

export type RpcError = z.infer<typeof rpcErrorSchema>;

export const rpcResponseSchema = z
  .object({
    protocolVersion: pluginRuntimeProtocolVersionSchema,
    requestId: z.string().min(1),
    success: z.boolean(),
    data: z.unknown().optional(),
    error: rpcErrorSchema.optional()
  })
  .strict();

export interface RpcResponse<TData> {
  protocolVersion: PluginRuntimeProtocolVersion;
  requestId: string;
  success: boolean;
  data?: TData;
  error?: RpcError;
}

export const pluginRuntimeHealthSnapshotSchema = z
  .object({
    pluginId: pluginIdSchema,
    status: pluginRuntimeStatusSchema,
    healthy: z.boolean(),
    processId: z.number().int().positive().optional(),
    initializedAt: isoTimestampSchema.optional(),
    activatedAt: isoTimestampSchema.optional(),
    restartCount: z.number().int().nonnegative().default(0),
    lastError: z.string().min(1).optional()
  })
  .strict();

export type PluginRuntimeHealthSnapshot = z.infer<
  typeof pluginRuntimeHealthSnapshotSchema
>;

export const initializePluginRequestSchema = z
  .object({
    protocolVersion: pluginRuntimeProtocolVersionSchema,
    type: z.literal("initialize-plugin"),
    requestId: z.string().min(1),
    pluginId: pluginIdSchema,
    installationRootPath: genericPathSchema,
    expectedContentHash: z.string().trim().length(64),
    manifest: pluginManifestSchema
  })
  .strict();

export const activatePluginRequestSchema = z
  .object({
    protocolVersion: pluginRuntimeProtocolVersionSchema,
    type: z.literal("activate-plugin"),
    requestId: z.string().min(1),
    pluginId: pluginIdSchema
  })
  .strict();

export const deactivatePluginRequestSchema = z
  .object({
    protocolVersion: pluginRuntimeProtocolVersionSchema,
    type: z.literal("deactivate-plugin"),
    requestId: z.string().min(1),
    pluginId: pluginIdSchema
  })
  .strict();

export const shutdownPluginRequestSchema = z
  .object({
    protocolVersion: pluginRuntimeProtocolVersionSchema,
    type: z.literal("shutdown-plugin"),
    requestId: z.string().min(1),
    pluginId: pluginIdSchema
  })
  .strict();

export const readConfigurationRequestSchema = z
  .object({
    protocolVersion: pluginRuntimeProtocolVersionSchema,
    type: z.literal("read-configuration"),
    requestId: z.string().min(1),
    pluginId: pluginIdSchema,
    key: z.string().min(1)
  })
  .strict();

export const invokePluginCapabilityRequestSchema = z
  .object({
    protocolVersion: pluginRuntimeProtocolVersionSchema,
    type: z.literal("invoke-plugin-capability"),
    requestId: z.string().min(1),
    pluginId: pluginIdSchema,
    capability: z.string().min(1),
    payload: jsonObjectSchema.default({})
  })
  .strict();

export const healthCheckRequestSchema = z
  .object({
    protocolVersion: pluginRuntimeProtocolVersionSchema,
    type: z.literal("health-check"),
    requestId: z.string().min(1),
    pluginId: pluginIdSchema
  })
  .strict();

export const pluginRuntimeRequestSchema = z.discriminatedUnion("type", [
  initializePluginRequestSchema,
  activatePluginRequestSchema,
  deactivatePluginRequestSchema,
  shutdownPluginRequestSchema,
  readConfigurationRequestSchema,
  invokePluginCapabilityRequestSchema,
  healthCheckRequestSchema
]);

export type InitializePluginRequest = z.infer<
  typeof initializePluginRequestSchema
>;
export type ActivatePluginRequest = z.infer<typeof activatePluginRequestSchema>;
export type DeactivatePluginRequest = z.infer<
  typeof deactivatePluginRequestSchema
>;
export type ShutdownPluginRequest = z.infer<typeof shutdownPluginRequestSchema>;
export type ReadConfigurationRequest = z.infer<
  typeof readConfigurationRequestSchema
>;
export type InvokePluginCapabilityRequest = z.infer<
  typeof invokePluginCapabilityRequestSchema
>;
export type HealthCheckRequest = z.infer<typeof healthCheckRequestSchema>;
export type PluginRuntimeRequest = z.infer<typeof pluginRuntimeRequestSchema>;

export const auditOutcomeSchema = z.enum([
  "success",
  "failure",
  "denied",
  "cancelled"
]);

export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;

export const auditEventSchema = z
  .object({
    id: z.string().min(1),
    timestamp: isoTimestampSchema,
    actorType: z.enum(["user", "agent", "workflow", "plugin", "system"]),
    actorId: z.string().min(1).optional(),
    action: z.string().min(1),
    resourceType: z.string().min(1).optional(),
    resourceId: z.string().min(1).optional(),
    outcome: auditOutcomeSchema,
    correlationId: z.string().min(1),
    metadata: jsonObjectSchema.optional()
  })
  .strict();

export type AuditEvent = z.infer<typeof auditEventSchema>;

export const REDACTED_VALUE = "[REDACTED]";

export const redactKeys = [
  "authorization",
  "apiKey",
  "credential",
  "password",
  "secret",
  "token"
] as const;
