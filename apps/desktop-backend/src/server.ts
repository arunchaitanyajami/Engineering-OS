import { createRequire } from "node:module";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { semanticVersionSchema } from "@engineering-os/contracts";
import {
  createLogger,
  type LogEntry,
  type LogTransport
} from "@engineering-os/logger";
import {
  PluginRuntimeError,
  PluginRuntimeService,
  type PluginRuntimeWorkerOptions
} from "@engineering-os/plugin-runtime";
import {
  PluginRegistryError,
  PluginRegistryService,
  SqlitePluginRegistryRepository
} from "@engineering-os/plugin-registry";
import {
  ApplicationDatabase,
  type ApplicationDatabaseHealth
} from "@engineering-os/database";
import type {
  EngineeringSession,
  LocalServicesStatus,
  PersistedLogEntry
} from "@engineering-os/platform";
import { z } from "zod";

import { PluginLifecycleService } from "./plugin-lifecycle-service.js";

const require = createRequire(import.meta.url);
const desktopPackageMetadata = require("../../desktop/package.json") as {
  readonly version?: unknown;
};

const CONFIG_FILE_NAME = "application-config.json";
const DATABASE_FILE_NAME = "engineering-os.sqlite";
const LOG_DIRECTORY_NAME = "logs";
const LOG_FILE_NAME = "application.log";
const DEFAULT_HOST = "127.0.0.1";
const MAX_CONFIG_BYTES = 128 * 1024;
const MAX_SESSION_BYTES = 16 * 1024;
const MAX_LOG_ENTRY_BYTES = 64 * 1024;
const MAX_JSON_PAYLOAD_BYTES = 256 * 1024;
const MAX_PLUGIN_PACKAGE_PATH_BYTES = 8 * 1024;
const SHUTDOWN_TIMEOUT_MS = 1_000;
const READY_MESSAGE_PREFIX = "ENGINEERING_OS_BACKEND_READY ";
const PLUGINS_DIRECTORY_NAME = "plugins";
const ALLOWED_TAURI_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost"
]);

interface JsonResponseOptions {
  readonly statusCode?: number;
}

const registerLocalPluginRequestSchema = z
  .object({
    packagePath: z.string().trim().min(1).max(MAX_PLUGIN_PACKAGE_PATH_BYTES)
  })
  .strict();

const pluginRuntimeControlRequestSchema = z
  .object({
    pluginId: z.string().trim().min(1).max(256)
  })
  .strict();

export interface BackendContext {
  readonly appDataDirectory: string;
  readonly configFilePath: string;
  readonly databaseFilePath: string;
  readonly logFilePath: string;
  readonly authToken: string;
  readonly allowedOrigin: string | null;
  readonly database: ApplicationDatabase;
  readonly pluginRegistry: PluginRegistryService;
  readonly pluginRuntime: PluginRuntimeService;
  readonly pluginLifecycle: PluginLifecycleService;
  readonly logger: ReturnType<typeof createLogger>;
  flushLogs(): Promise<void>;
}

export interface StartDesktopBackendServerOptions {
  readonly appDataDirectory?: string;
  readonly host?: string;
  readonly port?: number;
  readonly authToken?: string;
  readonly allowedOrigin?: string | null;
}

export interface StartedDesktopBackendServer {
  readonly context: BackendContext;
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly authToken: string;
  close(): Promise<void>;
}

class FileLogTransport implements LogTransport {
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly logFilePath: string) {}

  write(entry: LogEntry): void {
    const persistedEntry = {
      timestamp: entry.timestamp,
      level: entry.level,
      scope: entry.component,
      message: entry.message,
      ...(entry.metadata ? { context: entry.metadata } : {}),
      ...(entry.correlationId ? { correlationId: entry.correlationId } : {})
    } satisfies PersistedLogEntry;

    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(() => appendJsonLine(this.logFilePath, persistedEntry))
      .catch((error) => {
        console.error("Failed to append Engineering OS log entry.", error);
      });
  }

  flush(): Promise<void> {
    return this.pendingWrite;
  }
}

class BackendPublicError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    readonly statusCode: number,
    options?: { readonly cause?: unknown }
  ) {
    super(publicMessage, options);
    this.name = "BackendPublicError";
  }
}

export const getAppDataDirectory = (): string =>
  process.env.EOS_APPLICATION_DATA_DIR?.trim() ||
  join(process.cwd(), ".engineering-os-dev");

export const getBackendHost = (): string =>
  process.env.EOS_DESKTOP_BACKEND_HOST?.trim() || DEFAULT_HOST;

export const getBackendPort = (): number => {
  const candidate = process.env.EOS_DESKTOP_BACKEND_PORT?.trim();

  if (!candidate) {
    return 0;
  }

  const parsed = Number(candidate);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error("EOS_DESKTOP_BACKEND_PORT must be a valid TCP port.");
  }

  return parsed;
};

export const getBackendAuthToken = (): string => {
  const candidate = process.env.EOS_DESKTOP_BACKEND_AUTH_TOKEN?.trim();

  if (!candidate) {
    throw new Error(
      "EOS_DESKTOP_BACKEND_AUTH_TOKEN must be set for the desktop backend."
    );
  }

  return candidate;
};

export const getAllowedOrigin = (): string | null => {
  const candidate = process.env.EOS_DESKTOP_ALLOWED_ORIGIN?.trim();
  return candidate ? candidate : null;
};

export const getEngineeringOsVersion = (): string =>
  semanticVersionSchema.parse(
    process.env.EOS_TEST_APPLICATION_VERSION?.trim() ??
      desktopPackageMetadata.version
  );

const ensureDirectory = async (path: string) => {
  await mkdir(path, { recursive: true });
};

const canAccessPath = async (path: string): Promise<boolean> => {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const readOptionalFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
};

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

const asPublicError = (
  error: unknown,
  fallbackCode = "BACKEND_REQUEST_FAILED",
  fallbackMessage = "Desktop backend request failed.",
  fallbackStatusCode = 500
): BackendPublicError =>
  error instanceof PluginRegistryError
    ? new BackendPublicError(error.code, error.message, error.statusCode, {
        cause: error.cause ?? error
      })
    : error instanceof PluginRuntimeError
      ? new BackendPublicError(error.code, error.message, error.statusCode, {
          cause: error.cause ?? error
        })
      : error instanceof BackendPublicError
        ? error
        : new BackendPublicError(
            fallbackCode,
            fallbackMessage,
            fallbackStatusCode,
            {
              cause: error
            }
          );

const atomicWriteFile = async (
  path: string,
  contents: string,
  logger: BackendContext["logger"]
) => {
  const temporaryPath = `${path}.tmp`;
  const backupPath = `${path}.bak`;
  let movedPrimaryToBackup = false;

  await writeFile(temporaryPath, contents, "utf8");

  try {
    await rm(backupPath, { force: true });
    await rename(path, backupPath);
    movedPrimaryToBackup = true;
  } catch (error) {
    if (!isMissingFileError(error)) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  try {
    await rename(temporaryPath, path);
  } catch (error) {
    let backupRestored = false;

    if (movedPrimaryToBackup) {
      try {
        await rename(backupPath, path);
        backupRestored = true;
      } catch (restoreError) {
        logger.error(
          "Failed to restore configuration backup after write error.",
          restoreError,
          {
            path,
            backupPath
          }
        );
      }
    }

    await rm(temporaryPath, { force: true });
    logger.error(
      "Failed to replace persisted configuration atomically.",
      error,
      {
        path,
        backupPath,
        backupRestored
      }
    );
    throw new BackendPublicError(
      "CONFIG_WRITE_FAILED",
      "Application configuration could not be saved.",
      500,
      { cause: error }
    );
  }
};

const appendJsonLine = async (
  path: string,
  value: PersistedLogEntry
): Promise<void> => {
  await ensureDirectory(dirname(path));
  const serialized = `${JSON.stringify(value)}\n`;
  await writeFile(path, serialized, { encoding: "utf8", flag: "a" });
};

const createLocalServicesStatus = (
  health: ApplicationDatabaseHealth,
  context: Pick<
    BackendContext,
    "configFilePath" | "databaseFilePath" | "logFilePath"
  >
): LocalServicesStatus => ({
  database: {
    ok: true,
    status: "ready",
    migrationVersion: health.migrationVersion,
    databasePath: context.databaseFilePath
  },
  logFilePath: context.logFilePath,
  configFilePath: context.configFilePath
});

const validateSerializedConfig = (serializedConfig: string) => {
  if (serializedConfig.length > MAX_CONFIG_BYTES) {
    throw new BackendPublicError(
      "CONFIG_TOO_LARGE",
      "Application configuration exceeds the allowed size.",
      413
    );
  }

  try {
    JSON.parse(serializedConfig);
  } catch (error) {
    throw new BackendPublicError(
      "CONFIG_INVALID_JSON",
      "Application configuration is not valid JSON.",
      400,
      { cause: error }
    );
  }
};

const validateSession = (session: EngineeringSession) => {
  if (!session.id.trim() || session.id.length > 128) {
    throw new BackendPublicError(
      "SESSION_INVALID",
      "Session id must be present and shorter than 128 characters.",
      400
    );
  }

  if (!session.title.trim() || session.title.length > 200) {
    throw new BackendPublicError(
      "SESSION_INVALID",
      "Session title must be present and shorter than 200 characters.",
      400
    );
  }

  if (session.status !== "active" && session.status !== "archived") {
    throw new BackendPublicError(
      "SESSION_INVALID",
      "Session status must be active or archived.",
      400
    );
  }
};

const validateLogEntry = (entry: PersistedLogEntry) => {
  const validLevels = ["trace", "debug", "info", "warn", "error"];

  if (!validLevels.includes(entry.level)) {
    throw new BackendPublicError(
      "LOG_ENTRY_INVALID",
      "Log level is not supported.",
      400
    );
  }

  if (!entry.scope.trim() || !entry.message.trim()) {
    throw new BackendPublicError(
      "LOG_ENTRY_INVALID",
      "Log scope and message are required.",
      400
    );
  }
};

const validatePluginPackagePath = (packagePath: string) => {
  if (!packagePath.trim()) {
    throw new BackendPublicError(
      "PLUGIN_PACKAGE_PATH_INVALID",
      "Plugin package path is required.",
      400
    );
  }

  if (packagePath.length > MAX_PLUGIN_PACKAGE_PATH_BYTES) {
    throw new BackendPublicError(
      "PLUGIN_PACKAGE_PATH_INVALID",
      "Plugin package path exceeds the allowed size.",
      413
    );
  }
};

const readJsonBody = async <T>(
  request: IncomingMessage,
  maxBytes: number
): Promise<T> => {
  const contentLength = request.headers["content-length"];

  if (typeof contentLength === "string") {
    const parsedLength = Number(contentLength);

    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new BackendPublicError(
        "REQUEST_PAYLOAD_TOO_LARGE",
        "Request payload exceeds the allowed size.",
        413
      );
    }
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    receivedBytes += buffer.length;

    if (receivedBytes > Math.min(maxBytes, MAX_JSON_PAYLOAD_BYTES)) {
      throw new BackendPublicError(
        "REQUEST_PAYLOAD_TOO_LARGE",
        "Request payload exceeds the allowed size.",
        413
      );
    }

    chunks.push(buffer);
  }

  const serializedBody = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(serializedBody) as T;
  } catch (error) {
    throw new BackendPublicError(
      "REQUEST_INVALID_JSON",
      "Request body must be valid JSON.",
      400,
      { cause: error }
    );
  }
};

const readValidatedJsonBody = async <T>(
  request: IncomingMessage,
  maxBytes: number,
  schema: z.ZodType<T>,
  invalidCode: string,
  invalidMessage: string
): Promise<T> => {
  const parsedBody = await readJsonBody<unknown>(request, maxBytes);

  try {
    return schema.parse(parsedBody);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BackendPublicError(invalidCode, invalidMessage, 400, {
        cause: error
      });
    }

    throw error;
  }
};

const resolveAllowedOrigin = (
  request: Pick<IncomingMessage, "headers">,
  context: Pick<BackendContext, "allowedOrigin">
): string | null => {
  const origin = request.headers.origin;

  if (typeof origin !== "string" || !origin.trim()) {
    return null;
  }

  if (ALLOWED_TAURI_ORIGINS.has(origin) || context.allowedOrigin === origin) {
    return origin;
  }

  return null;
};

const applyCorsHeaders = (
  response: ServerResponse,
  request: Pick<IncomingMessage, "headers">,
  context: Pick<BackendContext, "allowedOrigin">
) => {
  const allowedOrigin = resolveAllowedOrigin(request, context);

  if (!allowedOrigin) {
    return;
  }

  response.setHeader("access-control-allow-origin", allowedOrigin);
  response.setHeader("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    "authorization, content-type"
  );
  response.setHeader("vary", "origin");
};

const writeJson = (
  response: ServerResponse,
  body: unknown,
  options: JsonResponseOptions = {}
) => {
  response.writeHead(options.statusCode ?? 200, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
};

const writeError = (
  response: ServerResponse,
  code: string,
  message: string,
  statusCode: number
) => {
  writeJson(
    response,
    {
      code,
      message
    },
    { statusCode }
  );
};

const writePublicError = (response: ServerResponse, error: unknown) => {
  const publicError = asPublicError(error);
  writeError(
    response,
    publicError.code,
    publicError.publicMessage,
    publicError.statusCode
  );
};

const constantTimeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

const validateAuthorization = (
  request: Pick<IncomingMessage, "headers">,
  authToken: string
) => {
  const authorizationHeader = request.headers.authorization;

  if (typeof authorizationHeader !== "string") {
    throw new BackendPublicError(
      "BACKEND_AUTH_REQUIRED",
      "Desktop backend authentication is required.",
      401
    );
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (
    scheme !== "Bearer" ||
    typeof token !== "string" ||
    !constantTimeEquals(token, authToken)
  ) {
    throw new BackendPublicError(
      "BACKEND_AUTH_INVALID",
      "Desktop backend authentication is invalid.",
      401
    );
  }
};

const loadPersistedConfig = async (
  context: Pick<BackendContext, "configFilePath" | "logger">
): Promise<string | null> => {
  const backupPath = `${context.configFilePath}.bak`;
  const primaryConfig = await readOptionalFile(context.configFilePath);

  if (primaryConfig !== null) {
    try {
      validateSerializedConfig(primaryConfig);
      return primaryConfig;
    } catch (error) {
      context.logger.warn(
        "Primary application configuration is invalid. Attempting backup recovery.",
        {
          configFilePath: context.configFilePath,
          backupPath
        }
      );
      const backupConfig = await readOptionalFile(backupPath);

      if (backupConfig === null) {
        throw new BackendPublicError(
          "CONFIG_READ_FAILED",
          "Application configuration could not be loaded.",
          500,
          { cause: error }
        );
      }

      validateSerializedConfig(backupConfig);
      await writeFile(context.configFilePath, backupConfig, "utf8");
      context.logger.warn("Recovered application configuration from backup.", {
        configFilePath: context.configFilePath,
        backupPath
      });
      return backupConfig;
    }
  }

  const backupConfig = await readOptionalFile(backupPath);

  if (backupConfig === null) {
    return null;
  }

  validateSerializedConfig(backupConfig);
  await writeFile(context.configFilePath, backupConfig, "utf8");
  context.logger.warn(
    "Restored missing application configuration from backup.",
    {
      configFilePath: context.configFilePath,
      backupPath
    }
  );
  return backupConfig;
};

const resolvePluginRuntimeWorkerOptions =
  async (): Promise<PluginRuntimeWorkerOptions> => {
    const currentModuleDirectory = dirname(fileURLToPath(import.meta.url));
    const builtWorkerPath = join(
      currentModuleDirectory,
      "plugin-runtime-worker.js"
    );

    if (await canAccessPath(builtWorkerPath)) {
      return {
        entryPointPath: builtWorkerPath,
        cwd: currentModuleDirectory
      };
    }

    return {
      entryPointPath: fileURLToPath(
        new URL("./plugin-runtime-worker.ts", import.meta.url)
      ),
      execArgv: ["--import", "tsx"],
      cwd: currentModuleDirectory
    };
  };

export const createBackendContext = async (
  appDataDirectory = getAppDataDirectory(),
  authToken = getBackendAuthToken(),
  allowedOrigin = getAllowedOrigin()
): Promise<BackendContext> => {
  const configFilePath = join(appDataDirectory, CONFIG_FILE_NAME);
  const databaseFilePath = join(appDataDirectory, DATABASE_FILE_NAME);
  const logFilePath = join(appDataDirectory, LOG_DIRECTORY_NAME, LOG_FILE_NAME);
  const pluginsDirectoryPath = join(appDataDirectory, PLUGINS_DIRECTORY_NAME);
  const fileLogTransport = new FileLogTransport(logFilePath);

  await ensureDirectory(appDataDirectory);
  await ensureDirectory(join(appDataDirectory, LOG_DIRECTORY_NAME));
  await ensureDirectory(pluginsDirectoryPath);

  const logger = createLogger({
    component: "desktop-backend",
    transport: fileLogTransport
  });
  const database = new ApplicationDatabase(databaseFilePath, logger);
  const pluginRegistryRepository = new SqlitePluginRegistryRepository(database);
  const pluginRegistry = new PluginRegistryService({
    repository: pluginRegistryRepository,
    logger,
    engineeringOsVersion: getEngineeringOsVersion(),
    installationsRootPath: pluginsDirectoryPath
  });
  const pluginRuntime = new PluginRuntimeService({
    pluginResolver: pluginRegistry,
    logger,
    worker: await resolvePluginRuntimeWorkerOptions()
  });
  const pluginLifecycle = new PluginLifecycleService({
    pluginRegistry,
    pluginRuntime
  });
  database.runMigrations();
  database.setMetadata("database_status", "ready");

  return {
    appDataDirectory,
    configFilePath,
    databaseFilePath,
    logFilePath,
    authToken,
    allowedOrigin,
    database,
    pluginRegistry,
    pluginRuntime,
    pluginLifecycle,
    logger,
    flushLogs: () => fileLogTransport.flush()
  };
};

export const createDesktopBackendHandler =
  (context: BackendContext) =>
  async (request: IncomingMessage, response: ServerResponse) => {
    applyCorsHeaders(response, request, context);
    const requestUrl = request.url
      ? new URL(request.url, "http://desktop-backend.local")
      : null;

    if (!requestUrl || !request.method) {
      writeError(
        response,
        "BACKEND_REQUEST_INVALID",
        "Request is incomplete.",
        400
      );
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      validateAuthorization(request, context.authToken);

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        writeJson(
          response,
          createLocalServicesStatus(context.database.getHealth(), context)
        );
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/config") {
        writeJson(response, {
          serializedConfig: await loadPersistedConfig(context)
        });
        return;
      }

      if (request.method === "PUT" && requestUrl.pathname === "/config") {
        const { serializedConfig } = await readJsonBody<{
          readonly serializedConfig: string;
        }>(request, MAX_CONFIG_BYTES);

        validateSerializedConfig(serializedConfig);
        await atomicWriteFile(
          context.configFilePath,
          serializedConfig,
          context.logger
        );
        writeJson(response, { ok: true });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/sessions") {
        writeJson(response, { sessions: context.database.listSessions() });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/sessions") {
        const { session } = await readJsonBody<{
          readonly session: EngineeringSession;
        }>(request, MAX_SESSION_BYTES);

        validateSession(session);
        writeJson(response, {
          session: context.database.createSession(session)
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/logs") {
        const { entry } = await readJsonBody<{
          readonly entry: PersistedLogEntry;
        }>(request, MAX_LOG_ENTRY_BYTES);

        validateLogEntry(entry);
        await appendJsonLine(context.logFilePath, entry);
        writeJson(response, { ok: true });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/plugins") {
        writeJson(response, {
          plugins: context.pluginRegistry.listInstalledPlugins()
        });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/plugins/register-local"
      ) {
        const { packagePath } = await readValidatedJsonBody(
          request,
          MAX_JSON_PAYLOAD_BYTES,
          registerLocalPluginRequestSchema,
          "PLUGIN_REGISTER_REQUEST_INVALID",
          "Plugin registration request is invalid."
        );

        validatePluginPackagePath(packagePath);
        writeJson(response, {
          plugin:
            await context.pluginRegistry.registerLocalPluginPackage(packagePath)
        });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/plugins/enable"
      ) {
        const { pluginId } = await readValidatedJsonBody(
          request,
          MAX_JSON_PAYLOAD_BYTES,
          pluginRuntimeControlRequestSchema,
          "PLUGIN_ENABLE_REQUEST_INVALID",
          "Plugin enable request is invalid."
        );

        writeJson(response, {
          plugin: await context.pluginLifecycle.enablePlugin(pluginId)
        });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/plugins/disable"
      ) {
        const { pluginId } = await readValidatedJsonBody(
          request,
          MAX_JSON_PAYLOAD_BYTES,
          pluginRuntimeControlRequestSchema,
          "PLUGIN_DISABLE_REQUEST_INVALID",
          "Plugin disable request is invalid."
        );
        writeJson(response, {
          plugin: await context.pluginLifecycle.disablePlugin(pluginId)
        });
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/plugins/runtime"
      ) {
        const pluginId = requestUrl.searchParams.get("pluginId")?.trim();

        if (!pluginId) {
          throw new BackendPublicError(
            "PLUGIN_RUNTIME_REQUEST_INVALID",
            "Plugin runtime request is invalid.",
            400
          );
        }

        writeJson(response, {
          runtime: await context.pluginRuntime.inspectPluginHealth(pluginId)
        });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/plugins/runtime/start"
      ) {
        const { pluginId } = await readValidatedJsonBody(
          request,
          MAX_JSON_PAYLOAD_BYTES,
          pluginRuntimeControlRequestSchema,
          "PLUGIN_RUNTIME_REQUEST_INVALID",
          "Plugin runtime request is invalid."
        );

        writeJson(response, {
          runtime: await context.pluginLifecycle.startPlugin(pluginId)
        });
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/plugins/runtime/stop"
      ) {
        const { pluginId } = await readValidatedJsonBody(
          request,
          MAX_JSON_PAYLOAD_BYTES,
          pluginRuntimeControlRequestSchema,
          "PLUGIN_RUNTIME_REQUEST_INVALID",
          "Plugin runtime request is invalid."
        );

        writeJson(response, {
          runtime: await context.pluginLifecycle.stopPlugin(pluginId)
        });
        return;
      }

      writeError(response, "BACKEND_ROUTE_NOT_FOUND", "Route not found.", 404);
    } catch (error) {
      const publicError = asPublicError(error);
      context.logger.error(
        "Desktop backend request failed.",
        publicError.cause ?? publicError,
        {
          method: request.method,
          path: request.url,
          code: publicError.code,
          statusCode: publicError.statusCode
        }
      );
      writePublicError(response, publicError);
    }
  };

const listen = async (
  server: Server,
  port: number,
  host: string
): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

const closeServer = async (
  server: Server,
  sockets: Set<Socket>
): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      for (const socket of sockets) {
        socket.destroy();
      }
    }, SHUTDOWN_TIMEOUT_MS);

    server.close((error) => {
      globalThis.clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

export const startDesktopBackendServer = async (
  options: StartDesktopBackendServerOptions = {}
): Promise<StartedDesktopBackendServer> => {
  const context = await createBackendContext(
    options.appDataDirectory,
    options.authToken,
    options.allowedOrigin
  );
  const host = options.host ?? getBackendHost();
  const port = options.port ?? getBackendPort();
  const server = createServer(createDesktopBackendHandler(context));
  const sockets = new Set<Socket>();

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await listen(server, port, host);

  const address = server.address();

  if (!address || typeof address === "string") {
    context.database.close();
    throw new Error("Desktop backend failed to expose a TCP address.");
  }

  const runtime: StartedDesktopBackendServer = {
    context,
    server,
    host: address.address,
    port: address.port,
    baseUrl: `http://${address.address}:${address.port}`,
    authToken: context.authToken,
    async close() {
      await context.flushLogs();
      await context.pluginRuntime.dispose();
      await closeServer(server, sockets);
      context.database.close();
    }
  };

  context.logger.info("Desktop backend is ready.", {
    host: runtime.host,
    port: runtime.port,
    appDataDirectory: context.appDataDirectory
  });

  console.log(
    `${READY_MESSAGE_PREFIX}${JSON.stringify({
      host: runtime.host,
      port: runtime.port
    })}`
  );

  return runtime;
};

export const startServer = async (): Promise<StartedDesktopBackendServer> =>
  startDesktopBackendServer();

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  void startServer().catch((error) => {
    console.error("Failed to start the Engineering OS desktop backend.", error);
    process.exitCode = 1;
  });
}
