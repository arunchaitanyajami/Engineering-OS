import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  mcpToolExecutionRecordSchema,
  mcpToolExecutionControlRequestSchema,
  toolExecutionResultSchema,
  toolExecutionRequestSchema,
  mcpCatalogSnapshotSchema,
  mcpServerRegistrationSchema,
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
  type ToolDescriptor,
  type ToolExecutionRequest,
  type ToolExecutionResult
} from "@engineering-os/contracts/unstable-runtime";
import type { Logger } from "@engineering-os/logger";
import type { InstalledPlugin } from "@engineering-os/plugin-registry";

import { ManagedStdioClientTransport } from "./managed-stdio-client-transport.js";

export interface InstalledPluginCatalog {
  listInstalledPlugins(): readonly InstalledPlugin[];
  getInstalledPlugin(pluginId: string): InstalledPlugin | null;
}

export interface McpGatewayServiceOptions {
  readonly installedPlugins: InstalledPluginCatalog;
  readonly logger: Logger;
  readonly systemRegistrations?: readonly McpServerRegistration[];
  readonly userRegistrations?: readonly McpServerRegistration[];
}

export interface McpGatewayCapabilityQuery {
  readonly pluginId?: string;
  readonly serverId?: string;
}

export interface McpGatewayToolExecutionOptions {
  readonly signal?: AbortSignal;
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
const MCP_GATEWAY_CLIENT_INFO = {
  name: "engineering-os-mcp-gateway",
  version: "0.1.0"
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

const inferToolRiskLevel = (
  annotations: McpListedTool["annotations"]
): ToolDescriptor["riskLevel"] => {
  if (annotations?.destructiveHint) {
    return "destructive";
  }

  if (annotations?.readOnlyHint) {
    return "read-only";
  }

  return "unknown";
};

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "AbortError";

const MAX_RETAINED_TOOL_EXECUTIONS = 200;

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

const normalizeToolDescriptor = (
  registration: RegisteredMcpServer,
  tool: McpListedTool
): ToolDescriptor => ({
  id: createCapabilityIdentifier(registration, "tool", tool.name),
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
  riskLevel: inferToolRiskLevel(tool.annotations)
});

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
  private readonly gatewayRegistrations = new Map<
    string,
    McpServerRegistration
  >();
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
  private readonly processEnv: NodeJS.ProcessEnv;
  private disposing = false;

  constructor(private readonly options: McpGatewayServiceOptions) {
    this.logger = options.logger.child({
      component: "mcp-gateway"
    });
    this.startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS;
    this.startupStabilityPeriodMs = DEFAULT_STARTUP_STABILITY_PERIOD_MS;
    this.shutdownGracePeriodMs = DEFAULT_SHUTDOWN_GRACE_PERIOD_MS;
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
      this.catalogs.delete(registrationId);
      this.discoveryStatuses.delete(registrationId);
      this.lastErrors.delete(registrationId);
    });
  }

  startToolExecution(request: ToolExecutionRequest): McpToolExecutionRecord {
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
    return this.requireToolExecution(executionIdValue).record;
  }

  async cancelToolExecution(
    executionIdValue: string
  ): Promise<McpToolExecutionRecord> {
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
        env: this.resolveTransportEnvironment(registration),
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

      try {
        await runtime.client.connect(runtime.transport, {
          timeout: this.startupTimeoutMs
        });
        await this.discoverCapabilities(runtime, registration);
        await this.waitForChildStability(
          runtime,
          this.startupStabilityPeriodMs
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
        this.catalogs.set(registrationId, createEmptyCatalog());
        this.discoveryStatuses.set(registrationId, "failed");
        this.lastErrors.set(registrationId, this.toErrorMessage(error));
        throw new McpGatewayError(
          "MCP_GATEWAY_SERVER_START_FAILED",
          `MCP server '${registrationId}' failed to start.`,
          502,
          error
        );
      }

      runtime.logger.info("Started MCP stdio server.", {
        registrationId,
        pid: runtime.transport.pid
      });

      return this.inspectServerHealth(registrationId);
    });
  }

  async stopServer(registrationId: string): Promise<McpServerHealthSnapshot> {
    return this.runWithLifecycleLock(registrationId, async () => {
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
    this.catalogs.set(registrationId, createEmptyCatalog());
    this.discoveryStatuses.set(registrationId, "not-started");
  }

  private resolveTransportEnvironment(
    registration: RegisteredMcpServer
  ): NodeJS.ProcessEnv {
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
      if (typeof value !== "string") {
        throw new McpGatewayError(
          "MCP_GATEWAY_SECRET_REFERENCES_UNSUPPORTED",
          `MCP server '${registration.registrationId}' requires secret resolution, which is not yet available.`,
          501
        );
      }

      environment[key] = value;
    }

    return environment;
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
    this.lastErrors.set(
      runtime.registrationId,
      `MCP server '${runtime.registrationId}' exited unexpectedly with ${reason}.`
    );
    runtime.logger.warn("MCP stdio server exited unexpectedly.", {
      registrationId: runtime.registrationId,
      code,
      signal
    });
  }

  private waitForChildStability(
    runtime: ManagedMcpServerRuntime,
    stabilityPeriodMs: number
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
        child.off("error", handleError);
        child.off("exit", handleExit);
      };

      child.once("error", handleError);
      child.once("exit", handleExit);
    });
  }

  private async discoverCapabilities(
    runtime: ManagedMcpServerRuntime,
    registration: RegisteredMcpServer
  ): Promise<void> {
    const serverCapabilities = runtime.client.getServerCapabilities();
    const tools = serverCapabilities?.tools
      ? await this.listAllTools(runtime)
      : [];
    const resources = serverCapabilities?.resources
      ? await this.listAllResources(runtime)
      : [];
    const prompts = serverCapabilities?.prompts
      ? await this.listAllPrompts(runtime)
      : [];
    const catalog = mcpCatalogSnapshotSchema.parse({
      tools: tools.map((tool) => normalizeToolDescriptor(registration, tool)),
      resources: resources.map((resource) =>
        normalizeResourceDescriptor(registration, resource)
      ),
      prompts: prompts.map((prompt) =>
        normalizePromptDescriptor(registration, prompt)
      )
    });

    this.catalogs.set(registration.registrationId, catalog);
    this.discoveryStatuses.set(registration.registrationId, "discovered");
  }

  private async listAllTools(
    runtime: ManagedMcpServerRuntime
  ): Promise<readonly McpListedTool[]> {
    const tools: McpListedTool[] = [];
    let cursor: string | undefined;

    while (true) {
      const result = await runtime.client.listTools(
        cursor ? { cursor } : undefined
      );
      tools.push(...result.tools);

      if (!result.nextCursor) {
        return tools;
      }

      cursor = result.nextCursor;
    }
  }

  private async listAllResources(
    runtime: ManagedMcpServerRuntime
  ): Promise<readonly McpListedResource[]> {
    const resources: McpListedResource[] = [];
    let cursor: string | undefined;

    while (true) {
      const result = await runtime.client.listResources(
        cursor ? { cursor } : undefined
      );
      resources.push(...result.resources);

      if (!result.nextCursor) {
        return resources;
      }

      cursor = result.nextCursor;
    }
  }

  private async listAllPrompts(
    runtime: ManagedMcpServerRuntime
  ): Promise<readonly McpListedPrompt[]> {
    const prompts: McpListedPrompt[] = [];
    let cursor: string | undefined;

    while (true) {
      const result = await runtime.client.listPrompts(
        cursor ? { cursor } : undefined
      );
      prompts.push(...result.prompts);

      if (!result.nextCursor) {
        return prompts;
      }

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
