import type { Brand, Result } from "@engineering-os/shared";
import type { Logger } from "@engineering-os/logger";
import type {
  EngineeringOsPluginContext,
  PermissionScope,
  PluginManifest
} from "@engineering-os/contracts";

export type {
  AuditEvent,
  CapabilityContent,
  EngineeringOsPlugin,
  EngineeringOsPluginContext,
  ExecutionContext,
  McpServerDefinition,
  McpServerRegistration,
  McpTransportConfiguration,
  NormalizedExecutionError,
  PermissionGrant,
  PermissionGrantDecision,
  PermissionScope,
  PluginCapability,
  PluginEntrypoints,
  PluginManifest,
  PluginPermissionRequest,
  PluginState,
  PromptDescriptor,
  ResourceDescriptor,
  RpcError,
  RpcResponse,
  SecretReference,
  SecretStore,
  ToolAnnotations,
  ToolDescriptor,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolRiskLevel
} from "@engineering-os/contracts";
export {
  activatePluginRequestSchema,
  auditEventSchema,
  capabilityContentSchema,
  deactivatePluginRequestSchema,
  executionContextSchema,
  healthCheckRequestSchema,
  initializePluginRequestSchema,
  invokePluginCapabilityRequestSchema,
  mcpServerDefinitionSchema,
  mcpServerRegistrationSchema,
  mcpTransportConfigurationSchema,
  normalizedExecutionErrorSchema,
  permissionGrantDecisionSchema,
  permissionGrantSchema,
  permissionScope,
  permissionScopeSchema,
  pluginManifestSchema,
  pluginPermissionRequestSchema,
  pluginRuntimeRequestSchema,
  pluginStateSchema,
  promptDescriptorSchema,
  readConfigurationRequestSchema,
  resourceDescriptorSchema,
  rpcErrorSchema,
  rpcResponseSchema,
  secretReferenceSchema,
  toolAnnotationsSchema,
  toolDescriptorSchema,
  toolExecutionRequestSchema,
  toolExecutionResultSchema,
  toolRiskLevelSchema
} from "@engineering-os/contracts";

export type PluginId = Brand<string, "PluginId">;
export type CapabilityId = Brand<string, "CapabilityId">;
export type AgentId = Brand<string, "AgentId">;
export type WorkflowId = Brand<string, "WorkflowId">;

export interface PluginContext {
  readonly logger: Logger;
  readonly correlationId: string;
}

export interface Capability {
  readonly id: CapabilityId;
  readonly version: string;
  readonly requiredPermissions: readonly PermissionScope[];
}

export type LegacyEngineeringOsPlugin = {
  readonly manifest: PluginManifest;
  initialize(context: EngineeringOsPluginContext | PluginContext): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  dispose(): Promise<void>;
};

export interface AgentDefinition {
  readonly id: AgentId;
  readonly name: string;
  readonly description: string;
  readonly requiredCapabilities: readonly CapabilityId[];
}

export interface WorkflowStepDefinition {
  readonly id: string;
  readonly name: string;
  readonly capabilityId?: CapabilityId;
}

export interface WorkflowDefinition {
  readonly id: WorkflowId;
  readonly version: string;
  readonly steps: readonly WorkflowStepDefinition[];
}

export interface ServiceRegistry {
  register<TService>(key: string, service: TService): void;
  resolve<TService>(key: string): Result<TService, ServiceNotFoundError>;
}

export class ServiceNotFoundError extends Error {
  constructor(serviceKey: string) {
    super(`Service "${serviceKey}" is not registered.`);
    this.name = "ServiceNotFoundError";
  }
}

export class InMemoryServiceRegistry implements ServiceRegistry {
  private readonly services = new Map<string, unknown>();

  register<TService>(key: string, service: TService): void {
    this.services.set(key, service);
  }

  resolve<TService>(key: string): Result<TService, ServiceNotFoundError> {
    const service = this.services.get(key);

    if (service === undefined) {
      return {
        ok: false,
        error: new ServiceNotFoundError(key)
      };
    }

    return {
      ok: true,
      value: service as TService
    };
  }
}
