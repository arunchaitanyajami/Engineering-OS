import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  pluginId,
  pluginManifestSchema,
  type PluginManifest
} from "@engineering-os/contracts";
import {
  pluginRuntimeHealthSnapshotSchema,
  pluginRuntimeRequestSchema,
  pluginRuntimeProtocolVersion,
  rpcResponseSchema,
  type EngineeringOsPlugin,
  type EngineeringOsPluginContext,
  type PluginRuntimeRequest,
  type PluginRuntimeStatus,
  type RpcError
} from "@engineering-os/contracts/unstable-runtime";

interface RuntimePluginState {
  readonly configurationStore: Map<string, unknown>;
  readonly storageStore: Map<string, unknown>;
  readonly secretsStore: Map<string, string>;
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
  configurationStore: new Map(),
  storageStore: new Map(),
  secretsStore: new Map(),
  pluginId: null,
  installationRootPath: null,
  manifest: null,
  instance: null,
  status: "stopped"
};

const createContext = (manifest: PluginManifest): EngineeringOsPluginContext => ({
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
  configuration: {
    async get<TValue>(key: string) {
      return (state.configurationStore.get(key) as TValue | undefined) ?? null;
    },
    async set<TValue>(key: string, value: TValue) {
      state.configurationStore.set(key, value);
    },
    async delete(key: string) {
      state.configurationStore.delete(key);
    }
  },
  secrets: {
    async get(key: string) {
      return state.secretsStore.get(key) ?? null;
    },
    async set(key: string, value: string) {
      state.secretsStore.set(key, value);
    },
    async delete(key: string) {
      state.secretsStore.delete(key);
    },
    async listKeys() {
      return [...state.secretsStore.keys()];
    }
  },
  storage: {
    async get<TValue>(key: string) {
      return (state.storageStore.get(key) as TValue | undefined) ?? null;
    },
    async set<TValue>(key: string, value: TValue) {
      state.storageStore.set(key, value);
    },
    async delete(key: string) {
      state.storageStore.delete(key);
    },
    async listKeys() {
      return [...state.storageStore.keys()];
    }
  },
  permissions: {
    async has() {
      return false;
    },
    async request() {
      return "deny";
    }
  },
  events: {
    async emit() {
      return;
    },
    async subscribe() {
      return async () => undefined;
    }
  },
  mcp: {
    async registerServer() {
      throw new Error("MCP registration is not implemented in Milestone 2.3.");
    },
    async listTools() {
      return [];
    },
    async executeTool() {
      return {
        status: "error",
        content: [],
        error: {
          code: "PLUGIN_RUNTIME_MCP_UNAVAILABLE",
          message: "MCP execution is not implemented in Milestone 2.3.",
          retryable: false
        }
      };
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

  process.send(
    rpcResponseSchema.parse({
      protocolVersion: pluginRuntimeProtocolVersion,
      requestId,
      ...response
    })
  );
};

const asRpcError = (error: unknown): RpcError => ({
  code:
    error instanceof Error && error.name
      ? error.name.toUpperCase()
      : "PLUGIN_RUNTIME_ERROR",
  message:
    error instanceof Error ? error.message : "Plugin runtime request failed."
});

const resolvePluginExport = (moduleExports: Record<string, unknown>) => {
  const candidate = (moduleExports.default ?? moduleExports.plugin) as
    | EngineeringOsPlugin
    | undefined;

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

      const moduleUrl = pathToFileURL(
        join(request.installationRootPath, request.manifest.entrypoints.backend)
      ).href;
      const moduleExports = (await import(moduleUrl)) as Record<string, unknown>;
      const plugin = resolvePluginExport(moduleExports);

      ensureManifestMatches(request.manifest, plugin.manifest);

      await plugin.initialize(createContext(request.manifest));

      state.instance = plugin;
      state.initializedAt = new Date().toISOString();

      return createSnapshot();
    }

    case "activate-plugin": {
      if (!state.instance) {
        throw new Error(`Plugin '${request.pluginId}' is not initialized.`);
      }

      await state.instance.activate();
      state.status = "running";
      state.activatedAt = new Date().toISOString();
      return createSnapshot();
    }

    case "deactivate-plugin": {
      if (!state.instance) {
        throw new Error(`Plugin '${request.pluginId}' is not initialized.`);
      }

      await state.instance.deactivate();
      state.status = "stopped";
      return createSnapshot();
    }

    case "health-check": {
      return createSnapshot();
    }

    case "shutdown-plugin": {
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

    case "read-configuration":
    case "invoke-plugin-capability": {
      throw new Error(
        `Plugin runtime request '${request.type}' is not implemented in Milestone 2.3.`
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
          error instanceof Error ? error.message : "Plugin runtime request failed.";
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
