import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  pluginId,
  pluginManifestSchema,
  type PermissionScope,
  type PluginManifest
} from "@engineering-os/contracts";
import {
  checkPluginPermissionBrokerResponseSchema,
  invokePluginCapabilityResponseSchema,
  pluginRuntimeBrokerRequestSchema,
  pluginRuntimeHealthSnapshotSchema,
  pluginRuntimeRequestSchema,
  pluginRuntimeProtocolVersion,
  readConfigurationResponseSchema,
  readPluginConfigurationBrokerResponseSchema,
  readPluginSecretBrokerResponseSchema,
  listPluginSecretKeysBrokerResponseSchema,
  requestPluginPermissionBrokerResponseSchema,
  rpcResponseSchema,
  type EngineeringOsPlugin,
  type EngineeringOsPluginContext,
  type PermissionGrantDecision,
  type PluginRuntimeBrokerRequest,
  type PluginRuntimeRequest,
  type PluginRuntimeStatus,
  type RpcError
} from "@engineering-os/contracts/unstable-runtime";
import { calculateManagedInstallationHash } from "@engineering-os/plugin-registry";

import {
  assertIpcMessageWithinLimit,
  estimateIpcMessageBytes
} from "./ipc-message-size.js";
import {
  assertSupportedProtocolVersion,
  PluginRuntimeProtocolError,
  readProtocolVersion
} from "./protocol.js";

interface RuntimePluginState {
  pluginId: string | null;
  installationRootPath: string | null;
  manifest: PluginManifest | null;
  instance: EngineeringOsPlugin | null;
  status: PluginRuntimeStatus;
  initializedAt?: string;
  activatedAt?: string;
  lastError?: string;
}

const state: RuntimePluginState = {
  pluginId: null,
  installationRootPath: null,
  manifest: null,
  instance: null,
  status: "stopped"
};

interface PendingBrokerResponse {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

const pendingBrokerResponses = new Map<string, PendingBrokerResponse>();

const BROKER_REQUEST_TIMEOUT_MS = 5_000;

const createUnsupportedMilestone23Error = (apiName: string) =>
  new Error(
    `${apiName} is not available in Milestone 2.3. Trusted local plugins run out of process, but process isolation is not a security sandbox yet.`
  );

const sendBrokerRequest = async (
  request: PluginRuntimeBrokerRequest
): Promise<unknown> => {
  if (!process.send) {
    throw new Error("Plugin runtime broker is unavailable in this worker.");
  }

  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      pendingBrokerResponses.delete(request.requestId);
      reject(new Error("Plugin runtime broker request timed out."));
    }, BROKER_REQUEST_TIMEOUT_MS);

    pendingBrokerResponses.set(request.requestId, {
      resolve,
      reject,
      timeout
    });

    try {
      assertIpcMessageWithinLimit(
        request,
        "Plugin runtime broker IPC request"
      );
    } catch (error) {
      clearTimeout(timeout);
      pendingBrokerResponses.delete(request.requestId);
      reject(error);
      return;
    }

    process.send?.(request, (error) => {
      if (!error) {
        return;
      }

      clearTimeout(timeout);
      pendingBrokerResponses.delete(request.requestId);
      reject(error);
    });
  });
};

const createConfigurationApi = (): EngineeringOsPluginContext["configuration"] => ({
  async get<TValue>(key: string): Promise<TValue | null> {
    if (!state.pluginId) {
      return null;
    }

    const response = await sendBrokerRequest(
      pluginRuntimeBrokerRequestSchema.parse({
        protocolVersion: pluginRuntimeProtocolVersion,
        type: "broker-read-configuration",
        requestId: randomUUID(),
        pluginId: state.pluginId,
        key
      })
    );

    return readPluginConfigurationBrokerResponseSchema.parse(response)
      .value as TValue | null;
  },
  async set() {
    return Promise.reject(
      createUnsupportedMilestone23Error("Plugin configuration persistence")
    );
  },
  async delete() {
    return Promise.reject(
      createUnsupportedMilestone23Error("Plugin configuration persistence")
    );
  }
});

const createSecretsApi = (): EngineeringOsPluginContext["secrets"] => ({
  async get(key) {
    if (!state.pluginId) {
      return null;
    }

    const response = await sendBrokerRequest(
      pluginRuntimeBrokerRequestSchema.parse({
        protocolVersion: pluginRuntimeProtocolVersion,
        type: "broker-read-secret",
        requestId: randomUUID(),
        pluginId: state.pluginId,
        key
      })
    );

    return readPluginSecretBrokerResponseSchema.parse(response).value;
  },
  async set(key, value) {
    if (!state.pluginId) {
      throw new Error("Plugin secret storage is unavailable.");
    }

    await sendBrokerRequest(
      pluginRuntimeBrokerRequestSchema.parse({
        protocolVersion: pluginRuntimeProtocolVersion,
        type: "broker-write-secret",
        requestId: randomUUID(),
        pluginId: state.pluginId,
        key,
        value
      })
    );
  },
  async delete(key) {
    if (!state.pluginId) {
      return;
    }

    await sendBrokerRequest(
      pluginRuntimeBrokerRequestSchema.parse({
        protocolVersion: pluginRuntimeProtocolVersion,
        type: "broker-delete-secret",
        requestId: randomUUID(),
        pluginId: state.pluginId,
        key
      })
    );
  },
  async listKeys() {
    if (!state.pluginId) {
      return [];
    }

    const response = await sendBrokerRequest(
      pluginRuntimeBrokerRequestSchema.parse({
        protocolVersion: pluginRuntimeProtocolVersion,
        type: "broker-list-secret-keys",
        requestId: randomUUID(),
        pluginId: state.pluginId
      })
    );

    return listPluginSecretKeysBrokerResponseSchema.parse(response).keys;
  }
});

const createContext = (
  manifest: PluginManifest
): EngineeringOsPluginContext => ({
  plugin: {
    id: pluginId(manifest.id),
    name: manifest.name,
    version: manifest.version
  },
  logger: {
    trace(message, metadata) {
      console.log(JSON.stringify({ level: "trace", message, metadata }));
    },
    debug(message, metadata) {
      console.log(JSON.stringify({ level: "debug", message, metadata }));
    },
    info(message, metadata) {
      console.log(JSON.stringify({ level: "info", message, metadata }));
    },
    warn(message, metadata) {
      console.warn(JSON.stringify({ level: "warn", message, metadata }));
    },
    error(message, error, metadata) {
      console.error(
        JSON.stringify({
          level: "error",
          message,
          metadata,
          error: error instanceof Error ? error.message : error
        })
      );
    }
  },
  configuration: createConfigurationApi(),
  secrets: createSecretsApi(),
  storage: {
    async get() {
      return Promise.reject(
        createUnsupportedMilestone23Error("Plugin storage")
      );
    },
    async set() {
      return Promise.reject(
        createUnsupportedMilestone23Error("Plugin storage")
      );
    },
    async delete() {
      return Promise.reject(
        createUnsupportedMilestone23Error("Plugin storage")
      );
    },
    async listKeys() {
      return Promise.reject(
        createUnsupportedMilestone23Error("Plugin storage")
      );
    }
  },
  permissions: {
    async has(scope: PermissionScope, constraint?: Record<string, unknown>) {
      if (!state.pluginId) {
        return false;
      }

      const response = await sendBrokerRequest(
        pluginRuntimeBrokerRequestSchema.parse({
          protocolVersion: pluginRuntimeProtocolVersion,
          type: "broker-check-permission",
          requestId: randomUUID(),
          pluginId: state.pluginId,
          scope,
          ...(constraint ? { constraint } : {})
        })
      );

      return checkPluginPermissionBrokerResponseSchema.parse(response).granted;
    },
    async request(
      scope: PermissionScope,
      reason: string,
      constraint?: Record<string, unknown>
    ): Promise<PermissionGrantDecision> {
      if (!state.pluginId) {
        return "deny";
      }

      const response = await sendBrokerRequest(
        pluginRuntimeBrokerRequestSchema.parse({
          protocolVersion: pluginRuntimeProtocolVersion,
          type: "broker-request-permission",
          requestId: randomUUID(),
          pluginId: state.pluginId,
          scope,
          reason,
          ...(constraint ? { constraint } : {})
        })
      );

      return requestPluginPermissionBrokerResponseSchema.parse(response)
        .decision;
    }
  },
  events: {
    async emit() {
      return Promise.reject(
        createUnsupportedMilestone23Error("Plugin event bus")
      );
    },
    async subscribe() {
      return Promise.reject(
        createUnsupportedMilestone23Error("Plugin event bus")
      );
    }
  },
  mcp: {
    async registerServer() {
      return Promise.reject(
        createUnsupportedMilestone23Error("Plugin MCP registration")
      );
    },
    async listTools() {
      return Promise.reject(
        createUnsupportedMilestone23Error("Plugin MCP tool access")
      );
    },
    async executeTool() {
      return Promise.reject(
        createUnsupportedMilestone23Error("Plugin MCP tool access")
      );
    }
  }
});

const createSnapshot = () =>
  pluginRuntimeHealthSnapshotSchema.parse({
    pluginId: state.pluginId ?? "unknown.plugin",
    status: state.status,
    healthy: state.status === "running",
    processId: process.pid,
    initializedAt: state.initializedAt,
    activatedAt: state.activatedAt,
    restartCount: 0,
    lastError: state.lastError
  });

const sendResponse = (
  requestId: string,
  response: {
    readonly success: boolean;
    readonly data?: unknown;
    readonly error?: RpcError;
  }
) => {
  if (!process.send) {
    return;
  }

  const payload = rpcResponseSchema.parse({
    protocolVersion: pluginRuntimeProtocolVersion,
    requestId,
    ...response
  });

  try {
    assertIpcMessageWithinLimit(payload, "Plugin runtime IPC response");
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Plugin runtime refused to send an oversized IPC response.",
        requestId,
        messageBytes: estimateIpcMessageBytes(payload),
        error: error instanceof Error ? error.message : error
      })
    );
    return;
  }

  process.send(payload);
};

const asRpcError = (error: unknown): RpcError => {
  if (error instanceof PluginRuntimeProtocolError) {
    return {
      code: "PLUGIN_RUNTIME_PROTOCOL_UNSUPPORTED",
      message: error.message
    };
  }

  return {
    code:
      error instanceof Error && error.name
        ? error.name.toUpperCase()
        : "PLUGIN_RUNTIME_ERROR",
    message:
      error instanceof Error ? error.message : "Plugin runtime request failed."
  };
};

class PluginRuntimeCapabilityUnsupportedError extends Error {
  constructor(capability: string) {
    super(`Plugin capability '${capability}' is not supported.`);
    this.name = "PLUGIN_RUNTIME_CAPABILITY_UNSUPPORTED";
  }
}

const resolvePluginExport = (moduleExports: Record<string, unknown>) => {
  const candidate = (moduleExports.default ?? moduleExports.plugin) as
    EngineeringOsPlugin | undefined;

  if (
    !candidate ||
    typeof candidate.initialize !== "function" ||
    typeof candidate.activate !== "function" ||
    typeof candidate.deactivate !== "function" ||
    typeof candidate.dispose !== "function"
  ) {
    throw new Error(
      "Plugin module must export a default plugin object with initialize, activate, deactivate, and dispose methods."
    );
  }

  return candidate;
};

const ensureManifestMatches = (
  expectedManifest: PluginManifest,
  actualManifest: unknown
) => {
  const parsedManifest = pluginManifestSchema.parse(actualManifest);

  if (
    parsedManifest.id !== expectedManifest.id ||
    parsedManifest.version !== expectedManifest.version
  ) {
    throw new Error(
      `Plugin module manifest '${parsedManifest.id}@${parsedManifest.version}' does not match installed manifest '${expectedManifest.id}@${expectedManifest.version}'.`
    );
  }
};

const ensureRequestTargetsInitializedPlugin = (pluginIdValue: string) => {
  if (state.pluginId && state.pluginId !== pluginIdValue) {
    throw new Error("Plugin runtime request targets a different plugin.");
  }
};

const verifyManagedInstallationBeforeImport = async (
  installationRootPath: string,
  expectedContentHash: string
) => {
  const currentHash =
    await calculateManagedInstallationHash(installationRootPath);

  if (currentHash !== expectedContentHash) {
    throw new Error(
      "Managed installation integrity verification failed inside the plugin runtime worker."
    );
  }
};

const handleRequest = async (request: PluginRuntimeRequest) => {
  switch (request.type) {
    case "initialize-plugin": {
      if (state.instance) {
        throw new Error(`Plugin '${request.pluginId}' is already initialized.`);
      }

      state.status = "starting";
      state.pluginId = request.pluginId;
      state.installationRootPath = request.installationRootPath;
      state.manifest = request.manifest;
      delete state.lastError;

      await verifyManagedInstallationBeforeImport(
        request.installationRootPath,
        request.expectedContentHash
      );

      const moduleUrl = pathToFileURL(
        join(request.installationRootPath, request.manifest.entrypoints.backend)
      ).href;
      const moduleExports = (await import(moduleUrl)) as Record<
        string,
        unknown
      >;
      const plugin = resolvePluginExport(moduleExports);

      ensureManifestMatches(request.manifest, plugin.manifest);

      await plugin.initialize(createContext(request.manifest));

      state.instance = plugin;
      state.initializedAt = new Date().toISOString();

      return createSnapshot();
    }

    case "activate-plugin": {
      ensureRequestTargetsInitializedPlugin(request.pluginId);

      if (!state.instance) {
        throw new Error(`Plugin '${request.pluginId}' is not initialized.`);
      }

      await state.instance.activate();
      state.status = "running";
      state.activatedAt = new Date().toISOString();
      return createSnapshot();
    }

    case "deactivate-plugin": {
      ensureRequestTargetsInitializedPlugin(request.pluginId);

      if (!state.instance) {
        throw new Error(`Plugin '${request.pluginId}' is not initialized.`);
      }

      await state.instance.deactivate();
      state.status = "stopped";
      return createSnapshot();
    }

    case "health-check": {
      ensureRequestTargetsInitializedPlugin(request.pluginId);
      return createSnapshot();
    }

    case "shutdown-plugin": {
      ensureRequestTargetsInitializedPlugin(request.pluginId);

      if (state.instance) {
        if (state.status === "running") {
          state.status = "stopping";
          await state.instance.deactivate();
        }

        await state.instance.dispose();
        state.instance = null;
      }

      state.status = "stopped";
      const snapshot = createSnapshot();

      globalThis.setTimeout(() => {
        process.exit(0);
      }, 0);

      return snapshot;
    }

    case "read-configuration": {
      ensureRequestTargetsInitializedPlugin(request.pluginId);

      const value = await createConfigurationApi().get(request.key);

      return readConfigurationResponseSchema.parse({ value });
    }

    case "invoke-plugin-capability": {
      ensureRequestTargetsInitializedPlugin(request.pluginId);
      throw new PluginRuntimeCapabilityUnsupportedError(request.capability);
    }

    default: {
      const exhaustiveRequest: never = request;
      throw new Error(
        `Plugin runtime request '${String(exhaustiveRequest)}' is not supported.`
      );
    }
  }
};

const handleShutdownSignal = async (signal: string) => {
  try {
    if (state.instance) {
      if (state.status === "running") {
        await state.instance.deactivate();
      }

      await state.instance.dispose();
      state.instance = null;
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Plugin runtime failed during signal shutdown.",
        signal,
        error: error instanceof Error ? error.message : error
      })
    );
  } finally {
    process.exit(0);
  }
};

export const runPluginRuntimeWorker = () => {
  process.on("message", (message) => {
    const parsedResponse = rpcResponseSchema.safeParse(message);

    if (parsedResponse.success) {
      const pending = pendingBrokerResponses.get(parsedResponse.data.requestId);

      if (pending) {
        clearTimeout(pending.timeout);
        pendingBrokerResponses.delete(parsedResponse.data.requestId);

        if (!parsedResponse.data.success) {
          pending.reject(
            new Error(
              parsedResponse.data.error?.message ??
                "Plugin runtime broker request failed."
            )
          );
          return;
        }

        pending.resolve(parsedResponse.data.data);
        return;
      }
    }

    const protocolVersion = readProtocolVersion(message);

    if (protocolVersion !== undefined) {
      try {
        assertSupportedProtocolVersion(protocolVersion);
      } catch (error) {
        const requestId =
          typeof message === "object" &&
          message !== null &&
          "requestId" in message &&
          typeof (message as { requestId: unknown }).requestId === "string"
            ? (message as { requestId: string }).requestId
            : "unknown-request";

        sendResponse(requestId, {
          success: false,
          error: asRpcError(error)
        });
        return;
      }
    }

    const parsedRequest = pluginRuntimeRequestSchema.safeParse(message);

    if (!parsedRequest.success) {
      sendResponse("unknown-request", {
        success: false,
        error: {
          code: "PLUGIN_RUNTIME_REQUEST_INVALID",
          message: "Plugin runtime request failed validation."
        }
      });
      return;
    }

    void handleRequest(parsedRequest.data)
      .then((data) => {
        sendResponse(parsedRequest.data.requestId, {
          success: true,
          data
        });
      })
      .catch((error) => {
        state.status = "failed";
        state.lastError =
          error instanceof Error
            ? error.message
            : "Plugin runtime request failed.";
        sendResponse(parsedRequest.data.requestId, {
          success: false,
          error: asRpcError(error)
        });
      });
  });

  process.once("SIGTERM", () => {
    void handleShutdownSignal("SIGTERM");
  });
  process.once("SIGINT", () => {
    void handleShutdownSignal("SIGINT");
  });
};
