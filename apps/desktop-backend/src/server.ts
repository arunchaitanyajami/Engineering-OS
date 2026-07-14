import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createLogger,
  type LogEntry,
  type LogTransport
} from "@engineering-os/logger";
import {
  ApplicationDatabase,
  type ApplicationDatabaseHealth
} from "@engineering-os/database";
import type {
  EngineeringSession,
  LocalServicesStatus,
  PersistedLogEntry
} from "@engineering-os/platform";

const CONFIG_FILE_NAME = "application-config.json";
const DATABASE_FILE_NAME = "engineering-os.sqlite";
const LOG_DIRECTORY_NAME = "logs";
const LOG_FILE_NAME = "application.log";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 43_110;
const MAX_CONFIG_BYTES = 128 * 1024;
const ALLOWED_TAURI_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost"
]);

interface JsonResponseOptions {
  readonly statusCode?: number;
}

export interface BackendContext {
  readonly appDataDirectory: string;
  readonly configFilePath: string;
  readonly databaseFilePath: string;
  readonly logFilePath: string;
  readonly database: ApplicationDatabase;
  readonly logger: ReturnType<typeof createLogger>;
}

export interface StartDesktopBackendServerOptions {
  readonly appDataDirectory?: string;
  readonly host?: string;
  readonly port?: number;
}

export interface StartedDesktopBackendServer {
  readonly context: BackendContext;
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  close(): Promise<void>;
}

class FileLogTransport implements LogTransport {
  constructor(private readonly logFilePath: string) {}

  write(entry: LogEntry): void {
    void appendJsonLine(this.logFilePath, {
      timestamp: entry.timestamp,
      level: entry.level,
      scope: entry.component,
      message: entry.message,
      ...(entry.metadata ? { context: entry.metadata } : {}),
      ...(entry.correlationId ? { correlationId: entry.correlationId } : {})
    });
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
    return DEFAULT_PORT;
  }

  const parsed = Number(candidate);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error("EOS_DESKTOP_BACKEND_PORT must be a valid TCP port.");
  }

  return parsed;
};

const ensureDirectory = async (path: string) => {
  await mkdir(path, { recursive: true });
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

const atomicWriteFile = async (path: string, contents: string) => {
  const temporaryPath = `${path}.tmp`;
  const backupPath = `${path}.bak`;

  await writeFile(temporaryPath, contents, "utf8");

  try {
    await rm(backupPath, { force: true });
    await rename(path, backupPath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  await rename(temporaryPath, path);
};

const appendJsonLine = async (
  path: string,
  value: PersistedLogEntry
): Promise<void> => {
  await ensureDirectory(join(path, ".."));
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
    throw new Error("Application configuration exceeds the allowed size.");
  }

  JSON.parse(serializedConfig);
};

const validateSession = (session: EngineeringSession) => {
  if (!session.id.trim() || session.id.length > 128) {
    throw new Error(
      "Session id must be present and shorter than 128 characters."
    );
  }

  if (!session.title.trim() || session.title.length > 200) {
    throw new Error(
      "Session title must be present and shorter than 200 characters."
    );
  }

  if (session.status !== "active" && session.status !== "archived") {
    throw new Error("Session status must be active or archived.");
  }
};

const validateLogEntry = (entry: PersistedLogEntry) => {
  const validLevels = ["trace", "debug", "info", "warn", "error"];

  if (!validLevels.includes(entry.level)) {
    throw new Error("Log level is not supported.");
  }

  if (!entry.scope.trim() || !entry.message.trim()) {
    throw new Error("Log scope and message are required.");
  }
};

const readJsonBody = async <T>(request: IncomingMessage): Promise<T> => {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const serializedBody = Buffer.concat(chunks).toString("utf8");

  return JSON.parse(serializedBody) as T;
};

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]" ||
        url.hostname === "::1")
    );
  } catch {
    return false;
  }
};

const resolveAllowedOrigin = (
  request: Pick<IncomingMessage, "headers">
): string | null => {
  const origin = request.headers.origin;

  if (typeof origin !== "string" || !origin.trim()) {
    return null;
  }

  if (isLoopbackOrigin(origin) || ALLOWED_TAURI_ORIGINS.has(origin)) {
    return origin;
  }

  return null;
};

const applyCorsHeaders = (
  response: ServerResponse,
  request: Pick<IncomingMessage, "headers">
) => {
  const allowedOrigin = resolveAllowedOrigin(request);

  if (!allowedOrigin) {
    return;
  }

  response.setHeader("access-control-allow-origin", allowedOrigin);
  response.setHeader("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
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
  error: unknown,
  statusCode = 500
) => {
  const message =
    error instanceof Error ? error.message : "Unknown backend error.";
  writeJson(
    response,
    {
      code,
      message
    },
    { statusCode }
  );
};

export const createBackendContext = async (
  appDataDirectory = getAppDataDirectory()
): Promise<BackendContext> => {
  const configFilePath = join(appDataDirectory, CONFIG_FILE_NAME);
  const databaseFilePath = join(appDataDirectory, DATABASE_FILE_NAME);
  const logFilePath = join(appDataDirectory, LOG_DIRECTORY_NAME, LOG_FILE_NAME);

  await ensureDirectory(appDataDirectory);
  await ensureDirectory(join(appDataDirectory, LOG_DIRECTORY_NAME));

  const logger = createLogger({
    component: "desktop-backend",
    transport: new FileLogTransport(logFilePath)
  });
  const database = new ApplicationDatabase(databaseFilePath, logger);
  database.runMigrations();
  database.setMetadata("database_status", "ready");

  return {
    appDataDirectory,
    configFilePath,
    databaseFilePath,
    logFilePath,
    database,
    logger
  };
};

export const createDesktopBackendHandler =
  (context: BackendContext) =>
  async (request: IncomingMessage, response: ServerResponse) => {
    applyCorsHeaders(response, request);

    if (!request.url || !request.method) {
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
      if (request.method === "GET" && request.url === "/health") {
        writeJson(
          response,
          createLocalServicesStatus(context.database.getHealth(), context)
        );
        return;
      }

      if (request.method === "GET" && request.url === "/config") {
        writeJson(response, {
          serializedConfig: await readOptionalFile(context.configFilePath)
        });
        return;
      }

      if (request.method === "PUT" && request.url === "/config") {
        const { serializedConfig } = await readJsonBody<{
          readonly serializedConfig: string;
        }>(request);

        validateSerializedConfig(serializedConfig);
        await atomicWriteFile(context.configFilePath, serializedConfig);
        writeJson(response, { ok: true });
        return;
      }

      if (request.method === "GET" && request.url === "/sessions") {
        writeJson(response, { sessions: context.database.listSessions() });
        return;
      }

      if (request.method === "POST" && request.url === "/sessions") {
        const { session } = await readJsonBody<{
          readonly session: EngineeringSession;
        }>(request);

        validateSession(session);
        writeJson(response, {
          session: context.database.createSession(session)
        });
        return;
      }

      if (request.method === "POST" && request.url === "/logs") {
        const { entry } = await readJsonBody<{
          readonly entry: PersistedLogEntry;
        }>(request);

        validateLogEntry(entry);
        await appendJsonLine(context.logFilePath, entry);
        writeJson(response, { ok: true });
        return;
      }

      writeError(response, "BACKEND_ROUTE_NOT_FOUND", "Route not found.", 404);
    } catch (error) {
      context.logger.error("Desktop backend request failed.", error, {
        method: request.method,
        path: request.url
      });
      writeError(response, "BACKEND_REQUEST_FAILED", error);
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

const closeServer = async (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
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
  const context = await createBackendContext(options.appDataDirectory);
  const host = options.host ?? getBackendHost();
  const port = options.port ?? getBackendPort();
  const server = createServer(createDesktopBackendHandler(context));

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
    async close() {
      await closeServer(server);
      context.database.close();
    }
  };

  context.logger.info("Desktop backend is ready.", {
    host: runtime.host,
    port: runtime.port,
    appDataDirectory: context.appDataDirectory
  });

  console.log(`Engineering OS desktop backend ready on ${runtime.baseUrl}`);

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
