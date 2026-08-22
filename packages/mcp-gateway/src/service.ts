import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { Ajv } from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  mcpToolExecutionRecordSchema,
  mcpToolExecutionControlRequestSchema,
  toolExecutionResultSchema,
  toolExecutionRequestSchema,
  mcpCatalogSnapshotSchema,
  mcpServerRegistrationSchema,
  promptDescriptorSchema,
  resourceDescriptorSchema,
  type CapabilityContent,
  type McpCapabilityDiscoveryStatus,
  mcpServerHealthSnapshotSchema,
  type McpServerRegistration,
  registeredMcpServerSchema,
  type McpCatalogSnapshot,
  type McpServerHealthSnapshot,
  type PromptDescriptor,
  type ResourceDescriptor,
  type RegisteredMcpServer,
  type McpToolExecutionRecord,
  toolDescriptorSchema,
  type ToolDescriptor,
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolAnnotations,
  type ToolRiskLevel,
  type GatewayEnvironmentValue,
  type SecretStore
} from "@engineering-os/contracts/unstable-runtime";
import type { Logger } from "@engineering-os/logger";
import type { InstalledPlugin } from "@engineering-os/plugin-registry";
import { ZodError } from "zod";

import { ManagedStdioClientTransport } from "./managed-stdio-client-transport.js";

export interface InstalledPluginCatalog {
  listInstalledPlugins(): readonly InstalledPlugin[];
  getInstalledPlugin(pluginId: string): InstalledPlugin | null;
}

export interface ToolRiskClassificationInput {
  readonly id: string;
  readonly name: string;
  readonly annotations?: ToolAnnotations;
}

export interface McpGatewayServiceOptions {
  readonly installedPlugins: InstalledPluginCatalog;
  readonly logger: Logger;
  readonly systemRegistrations?: readonly McpServerRegistration[];
  readonly userRegistrations?: readonly McpServerRegistration[];
  readonly startupTimeoutMs?: number;
  readonly startupStabilityPeriodMs?: number;
  readonly shutdownGracePeriodMs?: number;
  readonly restartWindowMs?: number;
  readonly maxRestartsPerWindow?: number;
  readonly restartBackoffMs?: number;
  readonly classifyToolRisk?: (
    input: ToolRiskClassificationInput
  ) => ToolRiskLevel;
  readonly secretStore?: SecretStore;
}

export interface McpGatewayCapabilityQuery {
  readonly pluginId?: string;
  readonly serverId?: string;
}

export interface McpGatewayToolExecutionOptions {
  readonly signal?: AbortSignal;
}

export interface McpToolExecutionListOptions {
  readonly state?: McpToolExecutionRecord["state"];
  readonly toolId?: string;
  readonly registrationId?: string;
  readonly serverId?: string;
  readonly correlationId?: string;
  readonly limit?: number;
}

export interface McpToolExecutionPageOptions extends McpToolExecutionListOptions {
  readonly cursor?: string;
}

export interface McpToolExecutionPage {
  readonly executions: readonly McpToolExecutionRecord[];
  readonly nextCursor?: string;
}

interface ToolArgumentValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
}

interface ParsedValidationIssue {
  readonly path: readonly (string | number)[];
  readonly message?: string;
}

interface StartupDeadline {
  readonly signal: AbortSignal;
  remainingMs(): number;
  dispose(): void;
}

export class McpGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 500,
    readonly cause?: unknown
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "McpGatewayError";
  }
}

const toRegisteredMcpServer = (
  installedPlugin: InstalledPlugin,
  definition: InstalledPlugin["manifest"]["mcp"][number]
): RegisteredMcpServer =>
  registeredMcpServerSchema.parse({
    registrationId: `${installedPlugin.pluginId}:${definition.id}`,
    serverId: definition.id,
    source: {
      type: "plugin",
      pluginId: installedPlugin.pluginId
    },
    name:
      definition.name ?? `${installedPlugin.manifest.name} / ${definition.id}`,
    transport: {
      type: "stdio",
      command: definition.command,
      args: definition.args,
      cwd: definition.cwd
        ? join(installedPlugin.installation.rootPath, definition.cwd)
        : installedPlugin.installation.rootPath,
      ...(definition.env ? { env: definition.env } : {}),
      ...(definition.timeoutMs ? { timeoutMs: definition.timeoutMs } : {})
    },
    enabled: installedPlugin.enabled,
    status: installedPlugin.enabled ? "registered" : "disabled"
  });

const createRegistrationId = (registration: McpServerRegistration): string =>
  registration.source.type === "plugin"
    ? `${registration.source.pluginId}:${registration.id}`
    : `${registration.source.type}:${registration.id}`;

const toRegisteredServerFromGatewayRegistration = (
  registration: McpServerRegistration
): RegisteredMcpServer =>
  registeredMcpServerSchema.parse({
    registrationId: createRegistrationId(registration),
    serverId: registration.id,
    source: registration.source,
    name: registration.name,
    transport:
      registration.transport.type === "stdio"
        ? {
            type: "stdio",
            command: registration.transport.command,
            args: registration.transport.args,
            ...(registration.transport.cwd
              ? { cwd: registration.transport.cwd }
              : {}),
            ...(registration.transport.env || registration.environment
              ? {
                  env: {
                    ...(registration.transport.env ?? {}),
                    ...(registration.environment ?? {})
                  }
                }
              : {}),
            ...(registration.timeoutMs
              ? { timeoutMs: registration.timeoutMs }
              : {})
          }
        : registration.transport,
    enabled: registration.enabled,
    status: registration.enabled ? "registered" : "disabled"
  });

const createEmptyCatalog = (): McpCatalogSnapshot =>
  mcpCatalogSnapshotSchema.parse({
    tools: [],
    resources: [],
    prompts: []
  });

const DEFAULT_STARTUP_TIMEOUT_MS = 3_000;
const DEFAULT_STARTUP_STABILITY_PERIOD_MS = 250;
const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 3_000;
const DEFAULT_RESTART_WINDOW_MS = 60_000;
const DEFAULT_MAX_RESTARTS_PER_WINDOW = 3;
const DEFAULT_RESTART_BACKOFF_MS = 250;
const MCP_GATEWAY_CLIENT_INFO = {
  name: "engineering-os-mcp-gateway",
  version: "0.2.0"
} as const;

type McpListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
type McpListedResource = Awaited<
  ReturnType<Client["listResources"]>
>["resources"][number];
type McpListedPrompt = Awaited<
  ReturnType<Client["listPrompts"]>
>["prompts"][number];
type McpCallToolResult = Awaited<ReturnType<Client["callTool"]>>;

const allowlistedEnvironmentKeys = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "NODE_ENV",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "LANG",
  "LC_ALL"
] as const;

interface ManagedMcpServerRuntime {
  readonly registrationId: string;
  readonly transport: ManagedStdioClientTransport;
  readonly client: Client;
  readonly logger: Logger;
  expectedExit: boolean;
}

interface ManagedToolExecution {
  readonly executionId: string;
  record: McpToolExecutionRecord;
  readonly controller: AbortController;
  completionPromise?: Promise<McpToolExecutionRecord>;
}

const toServerHealthSnapshot = (
  registration: RegisteredMcpServer,
  options: {
    readonly isRunning?: boolean;
    readonly discoveryStatus?: McpCapabilityDiscoveryStatus;
    readonly catalog?: McpCatalogSnapshot;
    readonly lastError?: string;
    readonly restartCount?: number;
  } = {}
): McpServerHealthSnapshot =>
  mcpServerHealthSnapshotSchema.parse({
    registrationId: registration.registrationId,
    serverId: registration.serverId,
    source: registration.source,
    name: registration.name,
    transport: registration.transport,
    enabled: registration.enabled,
    status: registration.status,
    healthState: options.lastError
      ? "unhealthy"
      : options.isRunning
        ? "healthy"
        : "unknown",
    discoveryStatus: options.discoveryStatus ?? "not-started",
    catalog: options.catalog ?? createEmptyCatalog(),
    restartCount: options.restartCount ?? 0,
    ...(options.lastError ? { lastError: options.lastError } : {})
  });

const normalizeIdentifierSegment = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .replace(/[._-]{2,}/g, "-");

  return normalized || "capability";
};

const createCapabilityIdentifier = (
  registration: RegisteredMcpServer,
  capabilityType: "tool" | "resource" | "prompt",
  sourceValue: string
): string => {
  const registrationScope = normalizeIdentifierSegment(
    registration.source.type === "plugin"
      ? `${registration.source.pluginId}.${registration.serverId}`
      : `${registration.source.type}.${registration.serverId}`
  );
  const baseIdentifier = `${registrationScope}.${capabilityType}.${normalizeIdentifierSegment(sourceValue)}`;

  if (baseIdentifier.length <= 128) {
    return baseIdentifier;
  }

  const hash = createHash("sha256")
    .update(sourceValue)
    .digest("hex")
    .slice(0, 12);
  const preservedLength = Math.max(
    1,
    128 - registrationScope.length - capabilityType.length - hash.length - 3
  );
  return `${registrationScope}.${capabilityType}.${normalizeIdentifierSegment(sourceValue).slice(0, preservedLength)}-${hash}`;
};

const normalizeToolDescriptor = (
  registration: RegisteredMcpServer,
  tool: McpListedTool,
  resolveRiskLevel: (input: ToolRiskClassificationInput) => ToolRiskLevel
): ToolDescriptor => {
  const id = createCapabilityIdentifier(registration, "tool", tool.name);

  return {
    id,
    serverId: registration.serverId,
    ...(registration.source.type === "plugin"
      ? { pluginId: registration.source.pluginId }
      : {}),
    name: tool.name,
    ...((tool.title ?? tool.annotations?.title)
      ? { title: tool.title ?? tool.annotations?.title }
      : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
    riskLevel: resolveRiskLevel({
      id,
      name: tool.name,
      ...(tool.annotations ? { annotations: tool.annotations } : {})
    })
  };
};

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "AbortError";

const MAX_RETAINED_TOOL_EXECUTIONS = 200;
const TOOL_EXECUTION_RETENTION_MS = 15 * 60 * 1_000;
const MAX_DISCOVERY_PAGES = 100;

const toPromptArgumentsSchema = (
  prompt: McpListedPrompt | undefined
): Record<string, unknown> | undefined => {
  const argumentsList = prompt?.arguments ?? [];

  if (argumentsList.length === 0) {
    return undefined;
  }

  const properties = Object.fromEntries(
    argumentsList.map((argument) => [
      argument.name,
      {
        type: "string",
        ...(argument.description ? { description: argument.description } : {})
      }
    ])
  );
  const requiredArguments = argumentsList
    .filter((argument) => argument.required)
    .map((argument) => argument.name);

  return {
    type: "object",
    properties,
    ...(requiredArguments.length > 0 ? { required: requiredArguments } : {})
  };
};

const normalizeResourceDescriptor = (
  registration: RegisteredMcpServer,
  resource: McpListedResource
): ResourceDescriptor => ({
  id: createCapabilityIdentifier(registration, "resource", resource.uri),
  serverId: registration.serverId,
  ...(registration.source.type === "plugin"
    ? { pluginId: registration.source.pluginId }
    : {}),
  name: resource.name,
  uri: resource.uri,
  ...(resource.description ? { description: resource.description } : {})
});

const normalizePromptDescriptor = (
  registration: RegisteredMcpServer,
  prompt: McpListedPrompt
): PromptDescriptor => ({
  id: createCapabilityIdentifier(registration, "prompt", prompt.name),
  serverId: registration.serverId,
  ...(registration.source.type === "plugin"
    ? { pluginId: registration.source.pluginId }
    : {}),
  name: prompt.name,
  ...(prompt.description ? { description: prompt.description } : {}),
  ...(toPromptArgumentsSchema(prompt)
    ? { argumentsSchema: toPromptArgumentsSchema(prompt) }
    : {})
});

export class McpGatewayService {
  private readonly logger: Logger;
  private readonly schemaValidator = new Ajv({
    allErrors: true,
    allowUnionTypes: true,
    strict: false,
    validateSchema: true
  });
  private readonly gatewayRegistrations = new Map<
    string,
    McpServerRegistration
  >();
  private readonly toolValidators = new Map<string, ValidateFunction>();
  private readonly toolExecutions = new Map<string, ManagedToolExecution>();
  private readonly toolExecutionOrder: string[] = [];
  private readonly runtimes = new Map<string, ManagedMcpServerRuntime>();
  private readonly lifecycleLocks = new Map<string, Promise<void>>();
  private readonly lastErrors = new Map<string, string>();
  private readonly catalogs = new Map<string, McpCatalogSnapshot>();
  private readonly discoveryStatuses = new Map<
    string,
    McpCapabilityDiscoveryStatus
  >();
  private readonly startupTimeoutMs: number;
  private readonly startupStabilityPeriodMs: number;
  private readonly shutdownGracePeriodMs: number;
  private readonly restartWindowMs: number;
  private readonly maxRestartsPerWindow: number;
  private readonly restartBackoffMs: number;
  private readonly desiredRunningServers = new Set<string>();
  private readonly crashHistory = new Map<string, number[]>();
  private readonly restartTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly processEnv: NodeJS.ProcessEnv;
  private disposing = false;

  constructor(private readonly options: McpGatewayServiceOptions) {
    this.logger = options.logger.child({
      component: "mcp-gateway"
    });
    this.startupTimeoutMs =
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.startupStabilityPeriodMs =
      options.startupStabilityPeriodMs ?? DEFAULT_STARTUP_STABILITY_PERIOD_MS;
    this.shutdownGracePeriodMs =
      options.shutdownGracePeriodMs ?? DEFAULT_SHUTDOWN_GRACE_PERIOD_MS;
    this.restartWindowMs =
      options.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS;
    this.maxRestartsPerWindow =
      options.maxRestartsPerWindow ?? DEFAULT_MAX_RESTARTS_PER_WINDOW;
    this.restartBackoffMs =
      options.restartBackoffMs ?? DEFAULT_RESTART_BACKOFF_MS;
    this.processEnv = process.env;

    for (const registration of options.systemRegistrations ?? []) {
      const parsedRegistration =
        mcpServerRegistrationSchema.parse(registration);

      if (parsedRegistration.source.type !== "system") {
        throw new McpGatewayError(
          "MCP_GATEWAY_SYSTEM_REGISTRATION_INVALID",
          "System MCP registrations must use the system source type.",
          500
        );
      }

      this.registerGatewayRegistration(parsedRegistration);
    }

    for (const registration of options.userRegistrations ?? []) {
      const parsedRegistration =
        mcpServerRegistrationSchema.parse(registration);

      if (parsedRegistration.source.type !== "user") {
        throw new McpGatewayError(
          "MCP_GATEWAY_USER_REGISTRATION_INVALID",
          "User MCP registrations must use the user source type.",
          500
        );
      }

      this.registerGatewayRegistration(parsedRegistration);
    }
  }

  listRegisteredServers(
    options: {
      readonly pluginId?: string;
    } = {}
  ): readonly RegisteredMcpServer[] {
    const plugins =
      typeof options.pluginId === "string"
        ? [
            this.options.installedPlugins.getInstalledPlugin(options.pluginId)
          ].filter((plugin): plugin is InstalledPlugin => plugin !== null)
        : this.options.installedPlugins.listInstalledPlugins();

    const registrations = plugins
      .filter((plugin) => plugin.state === "installed")
      .flatMap((plugin) =>
        plugin.manifest.mcp.map((definition) =>
          toRegisteredMcpServer(plugin, definition)
        )
      )
      .concat(
        [...this.gatewayRegistrations.values()]
          .filter((registration) =>
            options.pluginId ? registration.source.type === "plugin" : true
          )
          .map((registration) =>
            toRegisteredServerFromGatewayRegistration(registration)
          )
      )
      .sort((left, right) => {
        if (left.registrationId !== right.registrationId) {
          return left.registrationId.localeCompare(right.registrationId);
        }

        return left.serverId.localeCompare(right.serverId);
      });

    this.logger.debug("Listed MCP gateway registrations.", {
      pluginId: options.pluginId,
      registrationCount: registrations.length
    });

    return registrations;
  }

  listServerHealth(
    options: {
      readonly pluginId?: string;
    } = {}
  ): readonly McpServerHealthSnapshot[] {
    const healthSnapshots = this.listRegisteredServers(options).map(
      (registration) => {
        const lastError = this.lastErrors.get(registration.registrationId);

        return toServerHealthSnapshot(registration, {
          isRunning: this.runtimes.has(registration.registrationId),
          discoveryStatus:
            this.discoveryStatuses.get(registration.registrationId) ??
            "not-started",
          catalog:
            this.catalogs.get(registration.registrationId) ??
            createEmptyCatalog(),
          restartCount: this.getRestartCount(registration.registrationId),
          ...(lastError ? { lastError } : {})
        });
      }
    );

    this.logger.debug("Listed MCP gateway server health snapshots.", {
      pluginId: options.pluginId,
      snapshotCount: healthSnapshots.length
    });

    return healthSnapshots;
  }

  getCatalog(options: McpGatewayCapabilityQuery = {}): McpCatalogSnapshot {
    const relevantServers = this.listServerHealth(
      options.pluginId ? { pluginId: options.pluginId } : {}
    ).filter((server) =>
      options.serverId ? server.serverId === options.serverId : true
    );
    const catalog = mcpCatalogSnapshotSchema.parse({
      tools: relevantServers.flatMap((server) => server.catalog.tools),
      resources: relevantServers.flatMap((server) => server.catalog.resources),
      prompts: relevantServers.flatMap((server) => server.catalog.prompts)
    });

    this.logger.debug("Read MCP gateway capability catalog.", {
      pluginId: options.pluginId,
      serverId: options.serverId,
      toolCount: catalog.tools.length,
      resourceCount: catalog.resources.length,
      promptCount: catalog.prompts.length
    });

    return catalog;
  }

  listTools(
    options: McpGatewayCapabilityQuery = {}
  ): readonly ToolDescriptor[] {
    const tools = this.getCatalog(options).tools;

    this.logger.debug("Listed provider-independent MCP tools.", {
      pluginId: options.pluginId,
      serverId: options.serverId,
      toolCount: tools.length
    });

    return tools;
  }

  listResources(
    options: McpGatewayCapabilityQuery = {}
  ): readonly ResourceDescriptor[] {
    const resources = this.getCatalog(options).resources;

    this.logger.debug("Listed provider-independent MCP resources.", {
      pluginId: options.pluginId,
      serverId: options.serverId,
      resourceCount: resources.length
    });

    return resources;
  }

  listPrompts(
    options: McpGatewayCapabilityQuery = {}
  ): readonly PromptDescriptor[] {
    const prompts = this.getCatalog(options).prompts;

    this.logger.debug("Listed provider-independent MCP prompts.", {
      pluginId: options.pluginId,
      serverId: options.serverId,
      promptCount: prompts.length
    });

    return prompts;
  }

  refreshToolRiskLevels(): void {
    for (const [registrationId, catalog] of this.catalogs) {
      const refreshedTools = catalog.tools.map((tool) => ({
        ...tool,
        riskLevel: this.resolveToolRiskLevel({
          id: tool.id,
          name: tool.name,
          ...(tool.annotations ? { annotations: tool.annotations } : {})
        })
      }));

      this.setCatalog(registrationId, {
        ...catalog,
        tools: refreshedTools
      });
    }

    this.logger.debug("Refreshed MCP tool risk classifications.");
  }

  listUserRegistrations(): readonly McpServerRegistration[] {
    return [...this.gatewayRegistrations.values()]
      .filter((registration) => registration.source.type === "user")
      .sort((left, right) =>
        createRegistrationId(left).localeCompare(createRegistrationId(right))
      )
      .map((registration) => mcpServerRegistrationSchema.parse(registration));
  }

  registerServer(registration: McpServerRegistration): RegisteredMcpServer {
    const parsedRegistration = mcpServerRegistrationSchema.parse(registration);

    if (parsedRegistration.source.type === "plugin") {
      throw new McpGatewayError(
        "MCP_GATEWAY_PLUGIN_REGISTRATION_FORBIDDEN",
        "Plugin-backed MCP registrations are derived from installed plugin manifests.",
        409
      );
    }

    this.registerGatewayRegistration(parsedRegistration);
    return this.requireRegisteredServer(
      createRegistrationId(parsedRegistration)
    );
  }

  async unregisterServer(registrationId: string): Promise<void> {
    const registration = this.requireRegisteredServer(registrationId);

    if (registration.source.type === "plugin") {
      throw new McpGatewayError(
        "MCP_GATEWAY_PLUGIN_UNREGISTER_FORBIDDEN",
        `MCP server '${registrationId}' is managed by its plugin manifest and cannot be unregistered directly.`,
        409
      );
    }

    await this.runWithLifecycleLock(registrationId, async () => {
      const runtime = this.runtimes.get(registrationId);

      if (runtime) {
        await this.stopRuntime(runtime);
      }

      this.gatewayRegistrations.delete(registrationId);
      this.setCatalog(registrationId, createEmptyCatalog());
      this.catalogs.delete(registrationId);
      this.discoveryStatuses.delete(registrationId);
      this.lastErrors.delete(registrationId);
    });
  }

  startToolExecution(request: ToolExecutionRequest): McpToolExecutionRecord {
    this.pruneRetainedToolExecutions();
    const parsedRequest = toolExecutionRequestSchema.parse(request);
    const resolvedExecution = this.resolveToolExecution(parsedRequest);
    const createdExecutionId = randomUUID();
    const createdAt = new Date().toISOString();
    const managedExecution: ManagedToolExecution = {
      executionId: createdExecutionId,
      controller: new AbortController(),
      record: mcpToolExecutionRecordSchema.parse({
        executionId: createdExecutionId,
        toolId: parsedRequest.toolId,
        registrationId: resolvedExecution.registration.registrationId,
        serverId: resolvedExecution.registration.serverId,
        ...(resolvedExecution.registration.source.type === "plugin"
          ? { pluginId: resolvedExecution.registration.source.pluginId }
          : {}),
        request: parsedRequest,
        state: "running",
        startedAt: createdAt,
        updatedAt: createdAt
      })
    };
    this.toolExecutions.set(managedExecution.executionId, managedExecution);
    this.toolExecutionOrder.push(managedExecution.executionId);

    this.logger.info("Started MCP tool execution handle.", {
      executionId: managedExecution.executionId,
      toolId: parsedRequest.toolId,
      registrationId: resolvedExecution.registration.registrationId,
      correlationId: parsedRequest.executionContext.correlationId
    });

    managedExecution.completionPromise = this.executeTool(parsedRequest, {
      signal: managedExecution.controller.signal
    })
      .then((result) => {
        managedExecution.record = mcpToolExecutionRecordSchema.parse({
          ...managedExecution.record,
          state: "completed",
          updatedAt: new Date().toISOString(),
          result
        });
        this.pruneRetainedToolExecutions();
        return managedExecution.record;
      })
      .catch((error) => {
        const failedResult = toolExecutionResultSchema.parse({
          status: "error",
          content: [],
          error: {
            code: "MCP_TOOL_EXECUTION_FAILED",
            message:
              error instanceof Error
                ? error.message
                : `Tool '${parsedRequest.toolId}' failed.`,
            retryable: false
          }
        });

        managedExecution.record = mcpToolExecutionRecordSchema.parse({
          ...managedExecution.record,
          state: "completed",
          updatedAt: new Date().toISOString(),
          result: failedResult
        });
        this.pruneRetainedToolExecutions();
        return managedExecution.record;
      });

    return managedExecution.record;
  }

  getToolExecution(executionIdValue: string): McpToolExecutionRecord {
    this.pruneRetainedToolExecutions();
    return this.requireToolExecution(executionIdValue).record;
  }

  listToolExecutions(
    options: McpToolExecutionListOptions = {}
  ): readonly McpToolExecutionRecord[] {
    return this.listToolExecutionPage(options).executions;
  }

  listToolExecutionPage(
    options: McpToolExecutionPageOptions = {}
  ): McpToolExecutionPage {
    this.pruneRetainedToolExecutions();
    const limit = this.getToolExecutionListLimit(options.limit);
    const executions = this.collectFilteredToolExecutions(options);
    const startIndex = this.getToolExecutionPageStartIndex(
      executions,
      options.cursor
    );
    const pagedExecutions =
      typeof limit === "number"
        ? executions.slice(startIndex, startIndex + limit)
        : executions.slice(startIndex);
    const nextCursor =
      typeof limit === "number" &&
      startIndex + limit < executions.length &&
      pagedExecutions.length > 0
        ? pagedExecutions[pagedExecutions.length - 1]?.executionId
        : undefined;

    return {
      executions: pagedExecutions,
      ...(nextCursor ? { nextCursor } : {})
    };
  }

  async cancelToolExecution(
    executionIdValue: string
  ): Promise<McpToolExecutionRecord> {
    this.pruneRetainedToolExecutions();
    const parsedRequest = mcpToolExecutionControlRequestSchema.parse({
      executionId: executionIdValue
    });
    const execution = this.requireToolExecution(parsedRequest.executionId);

    if (execution.record.state === "completed") {
      return execution.record;
    }

    execution.controller.abort();

    if (!execution.completionPromise) {
      return execution.record;
    }

    return execution.completionPromise;
  }

  async executeTool(
    request: ToolExecutionRequest,
    options: McpGatewayToolExecutionOptions = {}
  ): Promise<ToolExecutionResult> {
    const parsedRequest = toolExecutionRequestSchema.parse(request);
    const resolvedTool = this.resolveToolExecution(parsedRequest);
    this.validateToolArguments(resolvedTool.tool, parsedRequest.arguments);
    const timeoutMs = this.getToolExecutionTimeoutMs(resolvedTool.registration);
    const startedAt = Date.now();

    this.logger.info("Executing MCP tool.", {
      toolId: parsedRequest.toolId,
      registrationId: resolvedTool.registration.registrationId,
      serverId: resolvedTool.registration.serverId,
      actorType: parsedRequest.executionContext.actor.type,
      actorId: parsedRequest.executionContext.actor.id,
      correlationId: parsedRequest.executionContext.correlationId,
      timeoutMs
    });

    try {
      const result = await resolvedTool.runtime.client.callTool(
        {
          name: resolvedTool.tool.name,
          arguments: parsedRequest.arguments
        },
        undefined,
        {
          timeout: timeoutMs,
          ...(options.signal ? { signal: options.signal } : {})
        }
      );
      const normalizedContent = this.extractToolResultContent(result);
      const normalizedResult = toolExecutionResultSchema.parse({
        status: result.isError ? "error" : "success",
        content: this.normalizeToolResultContent(normalizedContent),
        ...(result.structuredContent
          ? { metadata: { structuredContent: result.structuredContent } }
          : {}),
        ...(result.isError
          ? {
              error: {
                code: "MCP_TOOL_EXECUTION_ERROR",
                message: this.createToolErrorMessage(
                  this.normalizeToolResultContent(normalizedContent)
                ),
                retryable: false
              }
            }
          : {})
      });

      this.logger.info("Completed MCP tool execution.", {
        toolId: parsedRequest.toolId,
        registrationId: resolvedTool.registration.registrationId,
        correlationId: parsedRequest.executionContext.correlationId,
        status: normalizedResult.status,
        durationMs: Date.now() - startedAt
      });

      return normalizedResult;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        const cancelledResult = toolExecutionResultSchema.parse({
          status: "cancelled",
          content: [],
          error: {
            code: "MCP_TOOL_EXECUTION_CANCELLED",
            message: `Tool '${parsedRequest.toolId}' was cancelled.`,
            retryable: true
          }
        });

        this.logger.warn("Cancelled MCP tool execution.", {
          toolId: parsedRequest.toolId,
          registrationId: resolvedTool.registration.registrationId,
          correlationId: parsedRequest.executionContext.correlationId,
          status: cancelledResult.status,
          durationMs: Date.now() - startedAt
        });

        return cancelledResult;
      }

      if (
        error instanceof McpError &&
        error.code === ErrorCode.RequestTimeout
      ) {
        const timeoutResult = toolExecutionResultSchema.parse({
          status: "timeout",
          content: [],
          error: {
            code: "MCP_TOOL_EXECUTION_TIMEOUT",
            message: `Tool '${parsedRequest.toolId}' timed out.`,
            retryable: true
          }
        });

        this.logger.warn("Timed out MCP tool execution.", {
          toolId: parsedRequest.toolId,
          registrationId: resolvedTool.registration.registrationId,
          correlationId: parsedRequest.executionContext.correlationId,
          status: timeoutResult.status,
          durationMs: Date.now() - startedAt
        });

        return timeoutResult;
      }

      const failedResult = toolExecutionResultSchema.parse({
        status: "error",
        content: [],
        error: {
          code: "MCP_TOOL_EXECUTION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : `Tool '${parsedRequest.toolId}' failed.`,
          retryable: false
        }
      });

      this.logger.warn("Failed MCP tool execution.", {
        toolId: parsedRequest.toolId,
        registrationId: resolvedTool.registration.registrationId,
        correlationId: parsedRequest.executionContext.correlationId,
        status: failedResult.status,
        durationMs: Date.now() - startedAt,
        error: failedResult.error?.message
      });

      return failedResult;
    }
  }

  async startServer(registrationId: string): Promise<McpServerHealthSnapshot> {
    return this.runWithLifecycleLock(registrationId, async () => {
      this.throwIfDisposing();
      this.markDesiredRunning(registrationId);
      return this.startServerInternal(registrationId);
    });
  }

  private async startServerInternal(
    registrationId: string
  ): Promise<McpServerHealthSnapshot> {
      this.throwIfDisposing();
      const registration = this.requireRegisteredServer(registrationId);

      if (!registration.enabled) {
        throw new McpGatewayError(
          "MCP_GATEWAY_SERVER_DISABLED",
          `MCP server '${registrationId}' is disabled.`,
          409
        );
      }

      if (this.runtimes.has(registrationId)) {
        throw new McpGatewayError(
          "MCP_GATEWAY_SERVER_ALREADY_RUNNING",
          `MCP server '${registrationId}' is already running.`,
          409
        );
      }

      const transport = new ManagedStdioClientTransport({
        command: registration.transport.command,
        args: registration.transport.args,
        env: await this.resolveTransportEnvironment(registration),
        ...(registration.transport.cwd
          ? { cwd: registration.transport.cwd }
          : {}),
        shutdownGracePeriodMs: this.shutdownGracePeriodMs
      });
      const runtime: ManagedMcpServerRuntime = {
        registrationId,
        transport,
        client: new Client(MCP_GATEWAY_CLIENT_INFO, {
          capabilities: {}
        }),
        logger: this.logger.child({
          component: "mcp-gateway-child",
          correlationId: registrationId
        }),
        expectedExit: false
      };

      this.attachChildLogging(runtime);
      transport.onerror = (error) => {
        this.handleRuntimeFailure(runtime, error);
      };
      const startupDeadline = this.createStartupDeadline(registrationId);

      try {
        await runtime.client.connect(runtime.transport, {
          signal: startupDeadline.signal,
          timeout: startupDeadline.remainingMs()
        });
        await this.discoverCapabilities(runtime, registration, startupDeadline);
        await this.waitForChildStability(
          runtime,
          this.startupStabilityPeriodMs,
          startupDeadline.signal
        );
        this.throwIfDisposing();
        this.runtimes.set(registrationId, runtime);
        const child = runtime.transport.childProcess;

        if (child) {
          child.once("exit", (code, signal) => {
            this.handleChildExit(runtime, code, signal);
          });
        }

        this.lastErrors.delete(registrationId);
      } catch (error) {
        await this.safeCloseTransport(runtime);
        this.setCatalog(registrationId, createEmptyCatalog());
        this.discoveryStatuses.set(registrationId, "failed");
        this.lastErrors.set(
          registrationId,
          this.toStartupErrorMessage(registrationId, error)
        );
        throw new McpGatewayError(
          "MCP_GATEWAY_SERVER_START_FAILED",
          `MCP server '${registrationId}' failed to start.`,
          502,
          error
        );
      } finally {
        startupDeadline.dispose();
      }

      runtime.logger.info("Started MCP stdio server.", {
        registrationId,
        pid: runtime.transport.pid
      });

      return this.inspectServerHealth(registrationId);
  }

  async stopServer(registrationId: string): Promise<McpServerHealthSnapshot> {
    return this.runWithLifecycleLock(registrationId, async () => {
      this.clearDesiredRunning(registrationId);
      this.clearRestartTimer(registrationId);
      this.requireRegisteredServer(registrationId);
      const runtime = this.runtimes.get(registrationId);

      if (!runtime) {
        this.lastErrors.delete(registrationId);
        return this.inspectServerHealth(registrationId);
      }

      await this.stopRuntime(runtime);
      this.lastErrors.delete(registrationId);
      return this.inspectServerHealth(registrationId);
    });
  }

  async stopServersForPlugin(
    pluginId: string
  ): Promise<readonly McpServerHealthSnapshot[]> {
    const registrations = this.listRegisteredServers({ pluginId });
    return Promise.all(
      registrations.map((registration) =>
        this.stopServer(registration.registrationId)
      )
    );
  }

  async dispose(): Promise<void> {
    this.disposing = true;

    for (const registrationId of [...this.restartTimers.keys()]) {
      this.clearRestartTimer(registrationId);
    }

    this.desiredRunningServers.clear();

    const registrationIds = new Set<string>([
      ...this.runtimes.keys(),
      ...this.lifecycleLocks.keys()
    ]);

    await Promise.all(
      [...registrationIds].map((registrationId) =>
        this.stopServer(registrationId).catch((error) => {
          this.logger.warn(
            "Failed to stop MCP server during gateway disposal.",
            {
              registrationId,
              error: error instanceof Error ? error.message : String(error)
            }
          );
        })
      )
    );
  }

  inspectServerHealth(registrationId: string): McpServerHealthSnapshot {
    const registration = this.requireRegisteredServer(registrationId);
    const lastError = this.lastErrors.get(registrationId);

    return toServerHealthSnapshot(registration, {
      isRunning: this.runtimes.has(registrationId),
      discoveryStatus:
        this.discoveryStatuses.get(registrationId) ?? "not-started",
      catalog: this.catalogs.get(registrationId) ?? createEmptyCatalog(),
      restartCount: this.getRestartCount(registrationId),
      ...(lastError ? { lastError } : {})
    });
  }

  private requireRegisteredServer(registrationId: string): RegisteredMcpServer {
    const registration = this.listRegisteredServers().find(
      (candidate) => candidate.registrationId === registrationId
    );

    if (!registration) {
      throw new McpGatewayError(
        "MCP_GATEWAY_SERVER_NOT_FOUND",
        `MCP server '${registrationId}' is not registered.`,
        404
      );
    }

    if (registration.transport.type !== "stdio") {
      throw new McpGatewayError(
        "MCP_GATEWAY_TRANSPORT_UNSUPPORTED",
        `MCP server '${registrationId}' does not use a supported transport.`,
        409
      );
    }

    return registration;
  }

  private resolveToolExecution(request: ToolExecutionRequest): {
    readonly registration: RegisteredMcpServer;
    readonly runtime: ManagedMcpServerRuntime;
    readonly tool: ToolDescriptor;
  } {
    const resolvedTool = this.resolveToolExecutionTarget(request.toolId);

    if (!resolvedTool) {
      throw new McpGatewayError(
        "MCP_GATEWAY_TOOL_NOT_FOUND",
        `Tool '${request.toolId}' is not registered.`,
        404
      );
    }

    const runtime = this.runtimes.get(resolvedTool.registration.registrationId);

    if (!runtime) {
      throw new McpGatewayError(
        "MCP_GATEWAY_SERVER_NOT_RUNNING",
        `MCP server '${resolvedTool.registration.registrationId}' is not running.`,
        409
      );
    }

    return {
      registration: resolvedTool.registration,
      runtime,
      tool: resolvedTool.tool
    };
  }

  private getToolExecutionTimeoutMs(registration: RegisteredMcpServer): number {
    return registration.transport.type === "stdio"
      ? (registration.transport.timeoutMs ?? 30_000)
      : 30_000;
  }

  private createStartupDeadline(registrationId: string): StartupDeadline {
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.startupTimeoutMs);

    return {
      signal: controller.signal,
      remainingMs: () => {
        if (controller.signal.aborted) {
          throw this.createStartupTimeoutError(registrationId);
        }

        const remainingMs =
          this.startupTimeoutMs - (Date.now() - startedAt);

        if (remainingMs <= 0) {
          throw this.createStartupTimeoutError(registrationId);
        }

        return remainingMs;
      },
      dispose: () => {
        clearTimeout(timeout);
      }
    };
  }

  private createStartupTimeoutError(registrationId: string): McpGatewayError {
    return new McpGatewayError(
      "MCP_GATEWAY_STARTUP_TIMEOUT",
      `MCP server '${registrationId}' did not complete startup before the timeout expired.`,
      504
    );
  }

  private validateToolArguments(
    tool: ToolDescriptor,
    argumentsValue: ToolExecutionRequest["arguments"]
  ): void {
    const validator =
      this.toolValidators.get(tool.id) ?? this.compileToolValidator(tool);

    this.toolValidators.set(tool.id, validator);

    if (validator(argumentsValue)) {
      return;
    }

    throw new McpGatewayError(
      "MCP_GATEWAY_TOOL_ARGUMENTS_INVALID",
      `Arguments for tool '${tool.id}' are invalid.`,
      400,
      this.normalizeToolArgumentValidationErrors(validator.errors)
    );
  }

  private normalizeToolArgumentValidationErrors(
    errors: readonly ErrorObject[] | null | undefined
  ): readonly ToolArgumentValidationIssue[] {
    return (errors ?? []).slice(0, 10).map((error) => ({
      path: error.instancePath || "/",
      message: error.message ?? "Invalid value.",
      keyword: error.keyword
    }));
  }

  private resolveToolRiskLevel(
    input: ToolRiskClassificationInput
  ): ToolRiskLevel {
    return this.options.classifyToolRisk?.(input) ?? "unknown";
  }

  private setCatalog(
    registrationId: string,
    catalog: McpCatalogSnapshot
  ): void {
    const previousCatalog = this.catalogs.get(registrationId);
    const compiledValidators = new Map<string, ValidateFunction>();

    for (const tool of catalog.tools) {
      compiledValidators.set(tool.id, this.compileToolValidator(tool));
    }

    for (const tool of previousCatalog?.tools ?? []) {
      this.toolValidators.delete(tool.id);
    }

    for (const [toolId, validator] of compiledValidators) {
      this.toolValidators.set(toolId, validator);
    }

    this.catalogs.set(registrationId, catalog);
  }

  private compileToolValidator(tool: ToolDescriptor): ValidateFunction {
    try {
      return this.schemaValidator.compile(tool.inputSchema);
    } catch (error) {
      throw new McpGatewayError(
        "MCP_GATEWAY_TOOL_SCHEMA_INVALID",
        `Tool '${tool.id}' exposes an invalid JSON Schema.`,
        502,
        error
      );
    }
  }

  private getToolExecutionListLimit(
    limit: number | undefined
  ): number | undefined {
    if (limit === undefined) {
      return undefined;
    }

    if (!Number.isInteger(limit) || limit < 1) {
      throw new McpGatewayError(
        "MCP_GATEWAY_TOOL_EXECUTION_LIST_LIMIT_INVALID",
        "Execution list limit must be a positive integer.",
        400
      );
    }

    return Math.min(limit, MAX_RETAINED_TOOL_EXECUTIONS);
  }

  private collectFilteredToolExecutions(
    options: McpToolExecutionListOptions
  ): readonly McpToolExecutionRecord[] {
    return [...this.toolExecutionOrder]
      .reverse()
      .map((executionIdValue) => this.toolExecutions.get(executionIdValue))
      .filter(
        (execution): execution is ManagedToolExecution =>
          execution !== undefined
      )
      .map((execution) => execution.record)
      .filter((execution) =>
        options.state ? execution.state === options.state : true
      )
      .filter((execution) =>
        options.toolId ? execution.toolId === options.toolId : true
      )
      .filter((execution) =>
        options.registrationId
          ? execution.registrationId === options.registrationId
          : true
      )
      .filter((execution) =>
        options.serverId ? execution.serverId === options.serverId : true
      )
      .filter((execution) =>
        options.correlationId
          ? execution.request.executionContext.correlationId ===
            options.correlationId
          : true
      );
  }

  private getToolExecutionPageStartIndex(
    executions: readonly McpToolExecutionRecord[],
    cursor: string | undefined
  ): number {
    if (!cursor) {
      return 0;
    }

    const parsedCursor = mcpToolExecutionControlRequestSchema.parse({
      executionId: cursor
    });
    const cursorIndex = executions.findIndex(
      (execution) => execution.executionId === parsedCursor.executionId
    );

    if (cursorIndex === -1) {
      throw new McpGatewayError(
        "MCP_GATEWAY_TOOL_EXECUTION_CURSOR_INVALID",
        `Execution list cursor '${parsedCursor.executionId}' was not found for the current filter set.`,
        400
      );
    }

    return cursorIndex + 1;
  }

  private requireToolExecution(executionIdValue: string): ManagedToolExecution {
    const parsedRequest = mcpToolExecutionControlRequestSchema.parse({
      executionId: executionIdValue
    });
    const execution = this.toolExecutions.get(parsedRequest.executionId);

    if (!execution) {
      throw new McpGatewayError(
        "MCP_GATEWAY_TOOL_EXECUTION_NOT_FOUND",
        `Tool execution '${parsedRequest.executionId}' was not found.`,
        404
      );
    }

    return execution;
  }

  private pruneRetainedToolExecutions(): void {
    const retentionCutoff = Date.now() - TOOL_EXECUTION_RETENTION_MS;

    for (const [executionIdValue, execution] of this.toolExecutions.entries()) {
      if (execution.record.state !== "completed") {
        continue;
      }

      const updatedAtTime = Date.parse(execution.record.updatedAt);

      if (Number.isNaN(updatedAtTime) || updatedAtTime >= retentionCutoff) {
        continue;
      }

      this.toolExecutions.delete(executionIdValue);
    }

    for (
      let index = this.toolExecutionOrder.length - 1;
      index >= 0;
      index -= 1
    ) {
      const executionIdValue = this.toolExecutionOrder[index];

      if (executionIdValue && this.toolExecutions.has(executionIdValue)) {
        continue;
      }

      this.toolExecutionOrder.splice(index, 1);
    }

    while (this.toolExecutions.size > MAX_RETAINED_TOOL_EXECUTIONS) {
      const nextExecutionId = this.toolExecutionOrder.shift();

      if (!nextExecutionId) {
        return;
      }

      const execution = this.toolExecutions.get(nextExecutionId);

      if (!execution || execution.record.state !== "completed") {
        this.toolExecutionOrder.push(nextExecutionId);
        return;
      }

      this.toolExecutions.delete(nextExecutionId);
    }
  }

  private resolveToolExecutionTarget(toolId: string):
    | {
        readonly registration: RegisteredMcpServer;
        readonly tool: ToolDescriptor;
      }
    | undefined {
    for (const server of this.listServerHealth()) {
      const tool = server.catalog.tools.find(
        (candidate) => candidate.id === toolId
      );

      if (tool) {
        return {
          registration: this.requireRegisteredServer(server.registrationId),
          tool
        };
      }
    }

    return undefined;
  }

  private registerGatewayRegistration(
    registration: McpServerRegistration
  ): void {
    const registrationId = createRegistrationId(registration);

    if (registration.transport.type !== "stdio") {
      throw new McpGatewayError(
        "MCP_GATEWAY_TRANSPORT_UNSUPPORTED",
        `MCP server '${registrationId}' does not use a supported transport.`,
        409
      );
    }

    if (this.gatewayRegistrations.has(registrationId)) {
      throw new McpGatewayError(
        "MCP_GATEWAY_REGISTRATION_ALREADY_EXISTS",
        `MCP server '${registrationId}' is already registered.`,
        409
      );
    }

    if (
      this.listRegisteredServers().some(
        (candidate) => candidate.registrationId === registrationId
      )
    ) {
      throw new McpGatewayError(
        "MCP_GATEWAY_REGISTRATION_ALREADY_EXISTS",
        `MCP server '${registrationId}' is already registered.`,
        409
      );
    }

    this.gatewayRegistrations.set(registrationId, registration);
    this.setCatalog(registrationId, createEmptyCatalog());
    this.discoveryStatuses.set(registrationId, "not-started");
  }

  private async resolveTransportEnvironment(
    registration: RegisteredMcpServer
  ): Promise<NodeJS.ProcessEnv> {
    const environment: NodeJS.ProcessEnv = {};

    for (const key of allowlistedEnvironmentKeys) {
      const value = this.processEnv[key];

      if (typeof value === "string" && value.length > 0) {
        environment[key] = value;
      }
    }

    for (const [key, value] of Object.entries(
      registration.transport.env ?? {}
    )) {
      environment[key] = await this.resolveEnvironmentValue(
        registration,
        value
      );
    }

    return environment;
  }

  private async resolveEnvironmentValue(
    registration: RegisteredMcpServer,
    value: GatewayEnvironmentValue
  ): Promise<string> {
    if (typeof value === "string") {
      return value;
    }

    const secretStore = this.options.secretStore;

    if (!secretStore) {
      throw new McpGatewayError(
        "MCP_GATEWAY_SECRET_REFERENCES_UNSUPPORTED",
        `MCP server '${registration.registrationId}' requires secret resolution, which is not yet available.`,
        501
      );
    }

    if ("namespace" in value) {
      const resolved = await secretStore.get(value.namespace, value.key);

      if (resolved === null) {
        throw new McpGatewayError(
          "MCP_GATEWAY_SECRET_NOT_FOUND",
          `Secret '${value.namespace}/${value.key}' is not available for MCP server '${registration.registrationId}'.`,
          404
        );
      }

      return resolved;
    }

    if (registration.source.type !== "plugin") {
      throw new McpGatewayError(
        "MCP_GATEWAY_SECRET_REFERENCE_INVALID",
        `Plugin secret references are not supported for MCP server '${registration.registrationId}'.`,
        409
      );
    }

    const resolved = await secretStore.get(
      registration.source.pluginId,
      value.key
    );

    if (resolved === null) {
      throw new McpGatewayError(
        "MCP_GATEWAY_SECRET_NOT_FOUND",
        `Secret '${registration.source.pluginId}/${value.key}' is not available for MCP server '${registration.registrationId}'.`,
        404
      );
    }

    return resolved;
  }

  private attachChildLogging(runtime: ManagedMcpServerRuntime): void {
    const lines = createInterface({
      input: runtime.transport.stderr
    });

    lines.on("line", (line) => {
      runtime.logger.warn(line, {
        registrationId: runtime.registrationId,
        pid: runtime.transport.pid,
        stream: "stderr"
      });
    });
  }

  private handleRuntimeFailure(
    runtime: ManagedMcpServerRuntime,
    error: unknown
  ): void {
    if (runtime.expectedExit) {
      return;
    }

    this.lastErrors.set(runtime.registrationId, this.toErrorMessage(error));
  }

  private handleChildExit(
    runtime: ManagedMcpServerRuntime,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    if (this.runtimes.get(runtime.registrationId) !== runtime) {
      return;
    }

    this.runtimes.delete(runtime.registrationId);

    if (runtime.expectedExit) {
      this.lastErrors.delete(runtime.registrationId);
      return;
    }

    const reason =
      code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
    const errorMessage = `MCP server '${runtime.registrationId}' exited unexpectedly with ${reason}.`;
    const restartCount = this.recordCrash(runtime.registrationId);

    this.lastErrors.set(runtime.registrationId, errorMessage);
    this.discoveryStatuses.set(runtime.registrationId, "failed");
    runtime.logger.warn("MCP stdio server exited unexpectedly.", {
      registrationId: runtime.registrationId,
      code,
      signal,
      restartCount
    });

    if (
      !this.desiredRunningServers.has(runtime.registrationId) ||
      this.disposing
    ) {
      return;
    }

    if (restartCount >= this.maxRestartsPerWindow) {
      this.clearDesiredRunning(runtime.registrationId);
      this.lastErrors.set(
        runtime.registrationId,
        `MCP server '${runtime.registrationId}' exceeded the restart limit after repeated crashes.`
      );
      return;
    }

    this.scheduleServerRestart(runtime.registrationId, errorMessage);
  }

  private scheduleServerRestart(
    registrationId: string,
    errorMessage: string
  ): void {
    this.clearRestartTimer(registrationId);

    const restartTimer = globalThis.setTimeout(() => {
      this.restartTimers.delete(registrationId);

      if (
        !this.desiredRunningServers.has(registrationId) ||
        this.disposing ||
        this.runtimes.has(registrationId)
      ) {
        return;
      }

      void this.runWithLifecycleLock(registrationId, async () => {
        if (
          !this.desiredRunningServers.has(registrationId) ||
          this.disposing ||
          this.runtimes.has(registrationId)
        ) {
          return;
        }

        try {
          await this.startServerInternal(registrationId);
        } catch (error) {
          this.lastErrors.set(
            registrationId,
            this.toStartupErrorMessage(registrationId, error)
          );
          this.discoveryStatuses.set(registrationId, "failed");
        }
      }).catch((restartError) => {
        this.lastErrors.set(
          registrationId,
          this.toErrorMessage(restartError)
        );
        this.discoveryStatuses.set(registrationId, "failed");
      });
    }, this.restartBackoffMs);

    this.restartTimers.set(registrationId, restartTimer);
    this.lastErrors.set(registrationId, errorMessage);
  }

  private recordCrash(registrationId: string): number {
    const now = Date.now();
    const activeWindow = (this.crashHistory.get(registrationId) ?? []).filter(
      (timestamp) => now - timestamp <= this.restartWindowMs
    );

    activeWindow.push(now);
    this.crashHistory.set(registrationId, activeWindow);
    return activeWindow.length;
  }

  private getRestartCount(registrationId: string): number {
    const now = Date.now();
    return (
      this.crashHistory
        .get(registrationId)
        ?.filter((timestamp) => now - timestamp <= this.restartWindowMs)
        .length ?? 0
    );
  }

  private markDesiredRunning(registrationId: string): void {
    this.desiredRunningServers.add(registrationId);
  }

  private clearDesiredRunning(registrationId: string): void {
    this.desiredRunningServers.delete(registrationId);
  }

  private clearRestartTimer(registrationId: string): void {
    const restartTimer = this.restartTimers.get(registrationId);

    if (!restartTimer) {
      return;
    }

    clearTimeout(restartTimer);
    this.restartTimers.delete(registrationId);
  }

  private waitForChildStability(
    runtime: ManagedMcpServerRuntime,
    stabilityPeriodMs: number,
    signal: AbortSignal
  ): Promise<void> {
    const child = runtime.transport.childProcess;

    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return Promise.reject(
        new McpGatewayError(
          "MCP_GATEWAY_SERVER_PROCESS_EXITED",
          `MCP server '${runtime.registrationId}' exited before startup completed.`,
          502
        )
      );
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, stabilityPeriodMs);
      const handleAbort = () => {
        cleanup();
        reject(this.createStartupTimeoutError(runtime.registrationId));
      };
      const handleError = (error: unknown) => {
        cleanup();
        reject(error);
      };
      const handleExit = () => {
        cleanup();
        reject(
          new McpGatewayError(
            "MCP_GATEWAY_SERVER_PROCESS_EXITED",
            `MCP server '${runtime.registrationId}' exited before startup completed.`,
            502
          )
        );
      };
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", handleAbort);
        child.off("error", handleError);
        child.off("exit", handleExit);
      };

      if (signal.aborted) {
        handleAbort();
        return;
      }

      signal.addEventListener("abort", handleAbort, { once: true });
      child.once("error", handleError);
      child.once("exit", handleExit);
    });
  }

  private async discoverCapabilities(
    runtime: ManagedMcpServerRuntime,
    registration: RegisteredMcpServer,
    startupDeadline: StartupDeadline
  ): Promise<void> {
    try {
      const serverCapabilities = runtime.client.getServerCapabilities();
      const tools = serverCapabilities?.tools
        ? await this.listAllTools(runtime, startupDeadline)
        : [];
      const resources = serverCapabilities?.resources
        ? await this.listAllResources(runtime, startupDeadline)
        : [];
      const prompts = serverCapabilities?.prompts
        ? await this.listAllPrompts(runtime, startupDeadline)
        : [];
      const catalog = mcpCatalogSnapshotSchema.parse({
        tools: tools.map((tool) =>
          this.normalizeDiscoveredToolDescriptor(registration, tool)
        ),
        resources: resources.map((resource) =>
          this.normalizeDiscoveredResourceDescriptor(registration, resource)
        ),
        prompts: prompts.map((prompt) =>
          this.normalizeDiscoveredPromptDescriptor(registration, prompt)
        )
      });

      this.setCatalog(registration.registrationId, catalog);
      this.discoveryStatuses.set(registration.registrationId, "discovered");
    } catch (error) {
      throw this.normalizeDiscoveryFailure(registration, error);
    }
  }

  private async listAllTools(
    runtime: ManagedMcpServerRuntime,
    startupDeadline: StartupDeadline
  ): Promise<readonly McpListedTool[]> {
    const tools: McpListedTool[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    let pageCount = 0;

    while (true) {
      if (pageCount >= MAX_DISCOVERY_PAGES) {
        throw new McpGatewayError(
          "MCP_GATEWAY_DISCOVERY_PAGE_LIMIT_EXCEEDED",
          `MCP tool discovery for '${runtime.registrationId}' exceeded the maximum page count.`,
          502
        );
      }

      pageCount += 1;
      const result = await runtime.client.listTools(
        cursor ? { cursor } : undefined,
        {
          signal: startupDeadline.signal,
          timeout: startupDeadline.remainingMs()
        }
      );
      tools.push(...result.tools);

      if (!result.nextCursor) {
        return tools;
      }

      if (seenCursors.has(result.nextCursor)) {
        throw new McpGatewayError(
          "MCP_GATEWAY_DISCOVERY_CURSOR_REPEATED",
          `MCP tool discovery for '${runtime.registrationId}' returned a repeated cursor.`,
          502
        );
      }

      seenCursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
  }

  private async listAllResources(
    runtime: ManagedMcpServerRuntime,
    startupDeadline: StartupDeadline
  ): Promise<readonly McpListedResource[]> {
    const resources: McpListedResource[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    let pageCount = 0;

    while (true) {
      if (pageCount >= MAX_DISCOVERY_PAGES) {
        throw new McpGatewayError(
          "MCP_GATEWAY_DISCOVERY_PAGE_LIMIT_EXCEEDED",
          `MCP resource discovery for '${runtime.registrationId}' exceeded the maximum page count.`,
          502
        );
      }

      pageCount += 1;
      const result = await runtime.client.listResources(
        cursor ? { cursor } : undefined,
        {
          signal: startupDeadline.signal,
          timeout: startupDeadline.remainingMs()
        }
      );
      resources.push(...result.resources);

      if (!result.nextCursor) {
        return resources;
      }

      if (seenCursors.has(result.nextCursor)) {
        throw new McpGatewayError(
          "MCP_GATEWAY_DISCOVERY_CURSOR_REPEATED",
          `MCP resource discovery for '${runtime.registrationId}' returned a repeated cursor.`,
          502
        );
      }

      seenCursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
  }

  private async listAllPrompts(
    runtime: ManagedMcpServerRuntime,
    startupDeadline: StartupDeadline
  ): Promise<readonly McpListedPrompt[]> {
    const prompts: McpListedPrompt[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    let pageCount = 0;

    while (true) {
      if (pageCount >= MAX_DISCOVERY_PAGES) {
        throw new McpGatewayError(
          "MCP_GATEWAY_DISCOVERY_PAGE_LIMIT_EXCEEDED",
          `MCP prompt discovery for '${runtime.registrationId}' exceeded the maximum page count.`,
          502
        );
      }

      pageCount += 1;
      const result = await runtime.client.listPrompts(
        cursor ? { cursor } : undefined,
        {
          signal: startupDeadline.signal,
          timeout: startupDeadline.remainingMs()
        }
      );
      prompts.push(...result.prompts);

      if (!result.nextCursor) {
        return prompts;
      }

      if (seenCursors.has(result.nextCursor)) {
        throw new McpGatewayError(
          "MCP_GATEWAY_DISCOVERY_CURSOR_REPEATED",
          `MCP prompt discovery for '${runtime.registrationId}' returned a repeated cursor.`,
          502
        );
      }

      seenCursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
  }

  private async safeCloseTransport(
    runtime: ManagedMcpServerRuntime
  ): Promise<void> {
    try {
      await runtime.transport.close();
    } catch (error) {
      this.lastErrors.set(runtime.registrationId, this.toErrorMessage(error));
    }
  }

  private async stopRuntime(runtime: ManagedMcpServerRuntime): Promise<void> {
    runtime.expectedExit = true;
    await this.safeCloseTransport(runtime);
    this.runtimes.delete(runtime.registrationId);
  }

  private throwIfDisposing(): void {
    if (this.disposing) {
      throw new McpGatewayError(
        "MCP_GATEWAY_DISPOSING",
        "MCP gateway is shutting down.",
        503
      );
    }
  }

  private normalizeToolResultContent(
    content: readonly {
      readonly type: string;
      readonly [key: string]: unknown;
    }[]
  ): readonly CapabilityContent[] {
    return content.map((item) => {
      if (item.type === "text" && typeof item.text === "string") {
        return {
          type: "text",
          text: item.text
        } satisfies CapabilityContent;
      }

      if (item.type === "resource_link" && typeof item.uri === "string") {
        return {
          type: "resource-link",
          uri: item.uri,
          ...(typeof item.title === "string" ? { title: item.title } : {})
        } satisfies CapabilityContent;
      }

      return {
        type: "json",
        value: item
      } satisfies CapabilityContent;
    });
  }

  private createToolErrorMessage(
    content: readonly CapabilityContent[]
  ): string {
    const textMessage = content.find((item) => item.type === "text");

    if (textMessage?.type === "text" && textMessage.text.trim()) {
      return textMessage.text;
    }

    return "MCP tool execution returned an error.";
  }

  private extractToolResultContent(result: McpCallToolResult): readonly {
    readonly type: string;
    readonly [key: string]: unknown;
  }[] {
    if ("content" in result && Array.isArray(result.content)) {
      return result.content;
    }

    return [];
  }

  private normalizeDiscoveredToolDescriptor(
    registration: RegisteredMcpServer,
    tool: McpListedTool
  ): ToolDescriptor {
    const normalizedTool = normalizeToolDescriptor(
      registration,
      tool,
      (input) => this.resolveToolRiskLevel(input)
    );

    try {
      return toolDescriptorSchema.parse(normalizedTool);
    } catch (error) {
      if (
        error instanceof ZodError &&
        error.issues.some((issue) => issue.path[0] === "inputSchema")
      ) {
        throw new McpGatewayError(
          "MCP_GATEWAY_TOOL_SCHEMA_INVALID",
          `Tool '${normalizedTool.id}' exposes an invalid JSON Schema.`,
          502,
          this.normalizeDiscoveryValidationIssues(error)
        );
      }

      throw new McpGatewayError(
        "MCP_GATEWAY_TOOL_DESCRIPTOR_INVALID",
        `Tool '${normalizedTool.id}' returned an invalid descriptor during discovery.`,
        502,
        error instanceof ZodError
          ? this.normalizeDiscoveryValidationIssues(error)
          : error
      );
    }
  }

  private normalizeDiscoveredResourceDescriptor(
    registration: RegisteredMcpServer,
    resource: McpListedResource
  ): ResourceDescriptor {
    const normalizedResource = normalizeResourceDescriptor(registration, resource);

    try {
      return resourceDescriptorSchema.parse(normalizedResource);
    } catch (error) {
      throw new McpGatewayError(
        "MCP_GATEWAY_RESOURCE_DESCRIPTOR_INVALID",
        `Resource '${normalizedResource.id}' returned an invalid descriptor during discovery.`,
        502,
        error instanceof ZodError
          ? this.normalizeDiscoveryValidationIssues(error)
          : error
      );
    }
  }

  private normalizeDiscoveredPromptDescriptor(
    registration: RegisteredMcpServer,
    prompt: McpListedPrompt
  ): PromptDescriptor {
    const normalizedPrompt = normalizePromptDescriptor(registration, prompt);

    try {
      return promptDescriptorSchema.parse(normalizedPrompt);
    } catch (error) {
      throw new McpGatewayError(
        "MCP_GATEWAY_PROMPT_DESCRIPTOR_INVALID",
        `Prompt '${normalizedPrompt.id}' returned an invalid descriptor during discovery.`,
        502,
        error instanceof ZodError
          ? this.normalizeDiscoveryValidationIssues(error)
          : error
      );
    }
  }

  private normalizeDiscoveryValidationIssues(
    error: ZodError
  ): readonly {
    readonly path: string;
    readonly message: string;
  }[] {
    return error.issues.slice(0, 10).map((issue) => ({
      path: issue.path.length > 0 ? `/${issue.path.join("/")}` : "/",
      message: issue.message
    }));
  }

  private normalizeDiscoveryFailure(
    registration: RegisteredMcpServer,
    error: unknown
  ): unknown {
    if (error instanceof McpGatewayError) {
      return error;
    }

    const schemaError = this.createToolSchemaDiscoveryError(registration, error);

    if (schemaError) {
      return schemaError;
    }

    return error;
  }

  private createToolSchemaDiscoveryError(
    registration: RegisteredMcpServer,
    error: unknown
  ): McpGatewayError | null {
    const issues = this.readValidationIssues(error);
    const schemaIssue = issues?.find((issue) =>
      issue.path.some((segment) => segment === "inputSchema")
    );

    if (!schemaIssue) {
      return null;
    }

    const toolName = this.readDiscoveredToolName(error, schemaIssue);
    const toolId = toolName
      ? createCapabilityIdentifier(registration, "tool", toolName)
      : undefined;

    return new McpGatewayError(
      "MCP_GATEWAY_TOOL_SCHEMA_INVALID",
      toolId
        ? `Tool '${toolId}' exposes an invalid JSON Schema.`
        : "A discovered tool exposes an invalid JSON Schema.",
      502,
      issues?.slice(0, 10).map((issue) => ({
        path: issue.path.length > 0 ? `/${issue.path.join("/")}` : "/",
        message: issue.message ?? "Invalid value."
      }))
    );
  }

  private readValidationIssues(error: unknown): readonly ParsedValidationIssue[] | null {
    if (error instanceof ZodError) {
      return error.issues;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "issues" in error &&
      Array.isArray(error.issues)
    ) {
      return error.issues.filter(
        (issue): issue is ParsedValidationIssue =>
          typeof issue === "object" &&
          issue !== null &&
          "path" in issue &&
          Array.isArray(issue.path)
      );
    }

    if (error instanceof Error) {
      try {
        const parsedIssues: unknown = JSON.parse(error.message);

        if (
          Array.isArray(parsedIssues) &&
          parsedIssues.every(
            (issue) =>
              typeof issue === "object" &&
              issue !== null &&
              "path" in issue &&
              Array.isArray(issue.path)
          )
        ) {
          return parsedIssues as ParsedValidationIssue[];
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  private readDiscoveredToolName(
    error: unknown,
    issue: ParsedValidationIssue
  ): string | undefined {
    const toolsIndex = issue.path.indexOf("tools");

    if (toolsIndex === -1) {
      return undefined;
    }

    const toolIndex = issue.path[toolsIndex + 1];

    if (typeof toolIndex !== "number") {
      return undefined;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "input" in error &&
      typeof error.input === "object" &&
      error.input !== null &&
      "tools" in error.input &&
      Array.isArray(error.input.tools)
    ) {
      const tool = error.input.tools[toolIndex];

      if (
        typeof tool === "object" &&
        tool !== null &&
        "name" in tool &&
        typeof tool.name === "string" &&
        tool.name.length > 0
      ) {
        return tool.name;
      }
    }

    return undefined;
  }

  private toStartupErrorMessage(
    registrationId: string,
    error: unknown
  ): string {
    if (error instanceof McpGatewayError) {
      return error.message;
    }

    const registration = this.listRegisteredServers().find(
      (candidate) => candidate.registrationId === registrationId
    );

    if (registration) {
      const schemaError = this.createToolSchemaDiscoveryError(registration, error);

      if (schemaError) {
        return schemaError.message;
      }
    }

    if (this.isStartupTimeoutFailure(error)) {
      return this.createStartupTimeoutError(registrationId).message;
    }

    return this.toErrorMessage(error);
  }

  private isStartupTimeoutFailure(error: unknown): boolean {
    if (error instanceof McpGatewayError) {
      return error.code === "MCP_GATEWAY_STARTUP_TIMEOUT";
    }

    if (isAbortError(error)) {
      return true;
    }

    if (
      error instanceof McpError &&
      typeof error.message === "string" &&
      error.message.includes("AbortError")
    ) {
      return true;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "cause" in error &&
      this.isStartupTimeoutFailure(error.cause)
    ) {
      return true;
    }

    return (
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message.includes("AbortError")
    );
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async runWithLifecycleLock<T>(
    registrationId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const activeLock =
      this.lifecycleLocks.get(registrationId) ?? Promise.resolve();
    let releaseLock: () => void = () => undefined;
    const queuedLock = activeLock.then(
      () =>
        new Promise<void>((resolve) => {
          releaseLock = resolve;
        })
    );

    this.lifecycleLocks.set(registrationId, queuedLock);
    await activeLock;

    try {
      return await operation();
    } finally {
      releaseLock();

      if (this.lifecycleLocks.get(registrationId) === queuedLock) {
        this.lifecycleLocks.delete(registrationId);
      }
    }
  }
}
