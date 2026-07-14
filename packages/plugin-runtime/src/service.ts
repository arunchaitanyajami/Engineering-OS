import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import {
  activatePluginRequestSchema,
  healthCheckRequestSchema,
  initializePluginRequestSchema,
  pluginRuntimeHealthSnapshotSchema,
  pluginRuntimeProtocolVersion,
  rpcResponseSchema,
  shutdownPluginRequestSchema,
  type PluginRuntimeHealthSnapshot,
  type PluginRuntimeStatus
} from "@engineering-os/contracts/unstable-runtime";
import type { Logger } from "@engineering-os/logger";
import {
  calculateManagedInstallationHash,
  type InstalledPlugin
} from "@engineering-os/plugin-registry";

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_SHUTDOWN_GRACE_PERIOD_MS = 3_000;
const DEFAULT_RESTART_WINDOW_MS = 60_000;
const DEFAULT_MAX_RESTARTS_PER_WINDOW = 3;
const DEFAULT_RESTART_BACKOFF_MS = 250;

interface PendingResponse {
  readonly resolve: (value: { readonly data?: unknown }) => void;
  readonly reject: (error: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface ManagedPluginRuntime {
  readonly pluginId: string;
  readonly child: ChildProcess;
  readonly logger: Logger;
  readonly pendingResponses: Map<string, PendingResponse>;
  desiredState: "running" | "stopped";
  expectedExit: boolean;
  initializedAt?: string;
  activatedAt?: string;
}

export interface InstalledPluginResolver {
  getInstalledPlugin(pluginId: string): InstalledPlugin | null;
}

export interface PluginRuntimeWorkerOptions {
  readonly entryPointPath: string;
  readonly execPath?: string;
  readonly execArgv?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface PluginRuntimeServiceOptions {
  readonly pluginResolver: InstalledPluginResolver;
  readonly logger: Logger;
  readonly worker: PluginRuntimeWorkerOptions;
  readonly requestTimeoutMs?: number;
  readonly startupTimeoutMs?: number;
  readonly shutdownGracePeriodMs?: number;
  readonly restartWindowMs?: number;
  readonly maxRestartsPerWindow?: number;
  readonly restartBackoffMs?: number;
}

export class PluginRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 500,
    readonly cause?: unknown
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "PluginRuntimeError";
  }
}

export class PluginRuntimeService {
  private readonly logger: Logger;
  private readonly runtimes = new Map<string, ManagedPluginRuntime>();
  private readonly snapshots = new Map<string, PluginRuntimeHealthSnapshot>();
  private readonly crashHistory = new Map<string, number[]>();
  private readonly requestTimeoutMs: number;
  private readonly startupTimeoutMs: number;
  private readonly shutdownGracePeriodMs: number;
  private readonly restartWindowMs: number;
  private readonly maxRestartsPerWindow: number;
  private readonly restartBackoffMs: number;

  constructor(private readonly options: PluginRuntimeServiceOptions) {
    this.logger = options.logger.child({
      component: "plugin-runtime"
    });
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.startupTimeoutMs =
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.shutdownGracePeriodMs =
      options.shutdownGracePeriodMs ?? DEFAULT_SHUTDOWN_GRACE_PERIOD_MS;
    this.restartWindowMs =
      options.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS;
    this.maxRestartsPerWindow =
      options.maxRestartsPerWindow ?? DEFAULT_MAX_RESTARTS_PER_WINDOW;
    this.restartBackoffMs =
      options.restartBackoffMs ?? DEFAULT_RESTART_BACKOFF_MS;
  }

  getRuntimeHealth(pluginId: string): PluginRuntimeHealthSnapshot {
    return (
      this.snapshots.get(pluginId) ?? {
        pluginId,
        status: "stopped",
        healthy: false,
        restartCount: this.getRestartCount(pluginId)
      }
    );
  }

  async inspectPluginHealth(
    pluginId: string
  ): Promise<PluginRuntimeHealthSnapshot> {
    const runtime = this.runtimes.get(pluginId);

    if (!runtime) {
      return this.getRuntimeHealth(pluginId);
    }

    const response = await this.sendRequest(
      runtime,
      healthCheckRequestSchema.parse({
        protocolVersion: pluginRuntimeProtocolVersion,
        type: "health-check",
        requestId: randomUUID(),
        pluginId
      }),
      this.requestTimeoutMs
    );
    const snapshot = pluginRuntimeHealthSnapshotSchema.parse(response.data);
    const mergedSnapshot = {
      ...snapshot,
      restartCount: this.getRestartCount(pluginId)
    } satisfies PluginRuntimeHealthSnapshot;

    this.snapshots.set(pluginId, mergedSnapshot);
    return mergedSnapshot;
  }

  async startPlugin(pluginId: string): Promise<PluginRuntimeHealthSnapshot> {
    if (this.runtimes.has(pluginId)) {
      throw new PluginRuntimeError(
        "PLUGIN_RUNTIME_ALREADY_RUNNING",
        `Plugin '${pluginId}' is already running.`,
        409
      );
    }

    const installedPlugin = this.requireManagedInstalledPlugin(pluginId);
    await this.verifyManagedInstallation(installedPlugin);

    const runtime = this.createManagedRuntime(pluginId);
    this.runtimes.set(pluginId, runtime);
    this.updateSnapshot(pluginId, {
      status: "starting",
      healthy: false,
      ...(runtime.child.pid ? { processId: runtime.child.pid } : {}),
      restartCount: this.getRestartCount(pluginId)
    });

    try {
      await this.sendRequest(
        runtime,
        initializePluginRequestSchema.parse({
          protocolVersion: pluginRuntimeProtocolVersion,
          type: "initialize-plugin",
          requestId: randomUUID(),
          pluginId,
          installationRootPath: installedPlugin.installation.rootPath,
          manifest: installedPlugin.manifest
        }),
        this.startupTimeoutMs
      );
      runtime.initializedAt = new Date().toISOString();

      await this.sendRequest(
        runtime,
        activatePluginRequestSchema.parse({
          protocolVersion: pluginRuntimeProtocolVersion,
          type: "activate-plugin",
          requestId: randomUUID(),
          pluginId
        }),
        this.startupTimeoutMs
      );
      runtime.activatedAt = new Date().toISOString();

      this.recordHealthyStart(pluginId);

      return this.updateSnapshot(pluginId, {
        status: "running",
        healthy: true,
        ...(runtime.child.pid ? { processId: runtime.child.pid } : {}),
        ...(runtime.initializedAt
          ? { initializedAt: runtime.initializedAt }
          : {}),
        ...(runtime.activatedAt ? { activatedAt: runtime.activatedAt } : {}),
        restartCount: this.getRestartCount(pluginId)
      });
    } catch (error) {
      await this.forceCleanupRuntime(runtime);
      this.updateSnapshot(pluginId, {
        status: "failed",
        healthy: false,
        lastError: this.toErrorMessage(error),
        restartCount: this.getRestartCount(pluginId)
      });
      throw error;
    }
  }

  async stopPlugin(pluginId: string): Promise<PluginRuntimeHealthSnapshot> {
    const runtime = this.runtimes.get(pluginId);

    if (!runtime) {
      throw new PluginRuntimeError(
        "PLUGIN_RUNTIME_NOT_RUNNING",
        `Plugin '${pluginId}' is not running.`,
        409
      );
    }

    runtime.desiredState = "stopped";
    runtime.expectedExit = true;

    this.updateSnapshot(pluginId, {
      status: "stopping",
      healthy: false,
      ...(runtime.child.pid ? { processId: runtime.child.pid } : {}),
      ...(runtime.initializedAt
        ? { initializedAt: runtime.initializedAt }
        : {}),
      ...(runtime.activatedAt ? { activatedAt: runtime.activatedAt } : {}),
      restartCount: this.getRestartCount(pluginId)
    });

    try {
      await this.sendRequest(
        runtime,
        shutdownPluginRequestSchema.parse({
          protocolVersion: pluginRuntimeProtocolVersion,
          type: "shutdown-plugin",
          requestId: randomUUID(),
          pluginId
        }),
        this.shutdownGracePeriodMs
      );
    } catch (error) {
      runtime.logger.warn("Plugin runtime did not acknowledge shutdown request.", {
        code: error instanceof PluginRuntimeError ? error.code : "UNKNOWN_ERROR"
      });
    }

    await this.waitForChildExit(runtime, this.shutdownGracePeriodMs).catch(
      async () => {
        runtime.child.kill("SIGTERM");
        await this.waitForChildExit(runtime, this.shutdownGracePeriodMs).catch(
          () => {
            runtime.child.kill("SIGKILL");
          }
        );
      }
    );

    this.runtimes.delete(pluginId);
    return this.updateSnapshot(pluginId, {
      status: "stopped",
      healthy: false,
      restartCount: this.getRestartCount(pluginId)
    });
  }

  async dispose(): Promise<void> {
    const activePluginIds = [...this.runtimes.keys()];

    await Promise.all(
      activePluginIds.map((pluginId) =>
        this.stopPlugin(pluginId).catch((error) => {
          this.logger.error("Failed to stop plugin runtime during disposal.", error, {
            pluginId
          });
        })
      )
    );
  }

  private requireManagedInstalledPlugin(pluginId: string): InstalledPlugin {
    const installedPlugin = this.options.pluginResolver.getInstalledPlugin(pluginId);

    if (!installedPlugin) {
      throw new PluginRuntimeError(
        "PLUGIN_RUNTIME_PLUGIN_NOT_FOUND",
        `Plugin '${pluginId}' is not registered.`,
        404
      );
    }

    if (installedPlugin.state !== "installed") {
      throw new PluginRuntimeError(
        "PLUGIN_RUNTIME_PLUGIN_NOT_INSTALLABLE",
        `Plugin '${pluginId}' is not in an installable state.`,
        409
      );
    }

    if (installedPlugin.installation.mode !== "managed") {
      throw new PluginRuntimeError(
        "PLUGIN_RUNTIME_INSTALLATION_MODE_UNSUPPORTED",
        `Plugin '${pluginId}' must use a managed installation before it can be started.`,
        409
      );
    }

    if (!installedPlugin.installation.contentHash) {
      throw new PluginRuntimeError(
        "PLUGIN_RUNTIME_HASH_MISSING",
        `Plugin '${pluginId}' is missing a managed installation hash.`,
        500
      );
    }

    return installedPlugin;
  }

  private async verifyManagedInstallation(
    installedPlugin: InstalledPlugin
  ): Promise<void> {
    const currentHash = await calculateManagedInstallationHash(
      installedPlugin.installation.rootPath
    );

    if (currentHash === installedPlugin.installation.contentHash) {
      return;
    }

    throw new PluginRuntimeError(
      "PLUGIN_RUNTIME_INTEGRITY_CHECK_FAILED",
      `Plugin '${installedPlugin.pluginId}' failed managed installation integrity verification.`,
      409
    );
  }

  private createManagedRuntime(pluginId: string): ManagedPluginRuntime {
    const runtimeLogger = this.logger.child({
      component: "plugin-runtime-child"
    });
    const child = spawn(
      this.options.worker.execPath ?? process.execPath,
      [
        ...(this.options.worker.execArgv ?? []),
        this.options.worker.entryPointPath
      ],
      {
        cwd: this.options.worker.cwd,
        env: {
          ...process.env,
          ...this.options.worker.env
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"]
      }
    );

    const runtime: ManagedPluginRuntime = {
      pluginId,
      child,
      logger: runtimeLogger.child({
        correlationId: pluginId
      }),
      pendingResponses: new Map(),
      desiredState: "running",
      expectedExit: false
    };

    this.attachChildLogging(runtime, "stdout");
    this.attachChildLogging(runtime, "stderr");
    child.on("message", (message) => {
      this.handleChildMessage(runtime, message);
    });
    child.once("error", (error) => {
      this.handleRuntimeFailure(runtime, error);
    });
    child.once("exit", (code, signal) => {
      this.handleChildExit(runtime, code, signal);
    });

    return runtime;
  }

  private attachChildLogging(
    runtime: ManagedPluginRuntime,
    stream: "stdout" | "stderr"
  ) {
    const handle = runtime.child[stream];

    if (!handle) {
      return;
    }

    const lines = createInterface({
      input: handle
    });

    lines.on("line", (line) => {
      const metadata = {
        pluginId: runtime.pluginId,
        pid: runtime.child.pid,
        stream
      };

      if (stream === "stderr") {
        runtime.logger.warn(line, metadata);
        return;
      }

      runtime.logger.info(line, metadata);
    });
  }

  private handleChildMessage(runtime: ManagedPluginRuntime, message: unknown) {
    const parsedResponse = rpcResponseSchema.safeParse(message);

    if (!parsedResponse.success) {
      runtime.logger.warn("Plugin runtime sent an invalid RPC response.", {
        pluginId: runtime.pluginId
      });
      return;
    }

    const pending = runtime.pendingResponses.get(parsedResponse.data.requestId);

    if (!pending) {
      runtime.logger.warn("Plugin runtime sent an unexpected RPC response.", {
        pluginId: runtime.pluginId,
        requestId: parsedResponse.data.requestId
      });
      return;
    }

    clearTimeout(pending.timeout);
    runtime.pendingResponses.delete(parsedResponse.data.requestId);

    if (!parsedResponse.data.success) {
      pending.reject(
        new PluginRuntimeError(
          parsedResponse.data.error?.code ?? "PLUGIN_RUNTIME_REQUEST_FAILED",
          parsedResponse.data.error?.message ??
            `Plugin '${runtime.pluginId}' request failed.`,
          502,
          parsedResponse.data.error
        )
      );
      return;
    }

    pending.resolve(parsedResponse.data);
  }

  private handleRuntimeFailure(
    runtime: ManagedPluginRuntime,
    error: unknown
  ): void {
    this.handleUnexpectedTermination(runtime, error);
  }

  private handleChildExit(
    runtime: ManagedPluginRuntime,
    code: number | null,
    signal: NodeJS.Signals | null
  ) {
    const reason = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;

    for (const pending of runtime.pendingResponses.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new PluginRuntimeError(
          "PLUGIN_RUNTIME_PROCESS_EXITED",
          `Plugin '${runtime.pluginId}' exited before responding (${reason}).`
        )
      );
    }

    runtime.pendingResponses.clear();

    if (runtime.expectedExit && runtime.desiredState === "stopped") {
      this.runtimes.delete(runtime.pluginId);
      this.updateSnapshot(runtime.pluginId, {
        status: "stopped",
        healthy: false,
        restartCount: this.getRestartCount(runtime.pluginId)
      });
      return;
    }

    this.handleUnexpectedTermination(
      runtime,
      new PluginRuntimeError(
        "PLUGIN_RUNTIME_PROCESS_EXITED",
        `Plugin '${runtime.pluginId}' exited unexpectedly with ${reason}.`
      )
    );
  }

  private handleUnexpectedTermination(
    runtime: ManagedPluginRuntime,
    error: unknown
  ) {
    if (this.runtimes.get(runtime.pluginId)?.child !== runtime.child) {
      return;
    }

    this.runtimes.delete(runtime.pluginId);

    const restartCount = this.recordCrash(runtime.pluginId);
    const errorMessage = this.toErrorMessage(error);

    this.updateSnapshot(runtime.pluginId, {
      status: "failed",
      healthy: false,
      lastError: errorMessage,
      restartCount
    });

    runtime.logger.error("Plugin runtime terminated unexpectedly.", error, {
      pluginId: runtime.pluginId,
      restartCount
    });

    if (
      runtime.desiredState !== "running" ||
      restartCount > this.maxRestartsPerWindow
    ) {
      return;
    }

    this.updateSnapshot(runtime.pluginId, {
      status: "starting",
      healthy: false,
      restartCount,
      lastError: errorMessage
    });

    globalThis.setTimeout(() => {
      void this.startPlugin(runtime.pluginId).catch((restartError) => {
        this.updateSnapshot(runtime.pluginId, {
          status: "failed",
          healthy: false,
          lastError: this.toErrorMessage(restartError),
          restartCount: this.getRestartCount(runtime.pluginId)
        });
      });
    }, this.restartBackoffMs);
  }

  private async sendRequest(
    runtime: ManagedPluginRuntime,
    request: { readonly requestId: string },
    timeoutMs: number
  ): Promise<{ readonly data?: unknown }> {
    if (!runtime.child.connected) {
      throw new PluginRuntimeError(
        "PLUGIN_RUNTIME_CHANNEL_UNAVAILABLE",
        `Plugin '${runtime.pluginId}' IPC channel is unavailable.`,
        503
      );
    }

    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        runtime.pendingResponses.delete(request.requestId);
        reject(
          new PluginRuntimeError(
            "PLUGIN_RUNTIME_REQUEST_TIMEOUT",
            `Plugin '${runtime.pluginId}' request '${request.requestId}' timed out.`,
            504
          )
        );
      }, timeoutMs);

      runtime.pendingResponses.set(request.requestId, {
        resolve,
        reject,
        timeout
      });
      runtime.child.send(request, (error) => {
        if (!error) {
          return;
        }

        clearTimeout(timeout);
        runtime.pendingResponses.delete(request.requestId);
        reject(
          new PluginRuntimeError(
            "PLUGIN_RUNTIME_SEND_FAILED",
            `Plugin '${runtime.pluginId}' request '${request.requestId}' could not be sent.`,
            502,
            error
          )
        );
      });
    });
  }

  private waitForChildExit(
    runtime: ManagedPluginRuntime,
    timeoutMs: number
  ): Promise<void> {
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        reject(
          new PluginRuntimeError(
            "PLUGIN_RUNTIME_SHUTDOWN_TIMEOUT",
            `Plugin '${runtime.pluginId}' did not exit within the shutdown grace period.`,
            504
          )
        );
      }, timeoutMs);

      runtime.child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private async forceCleanupRuntime(
    runtime: ManagedPluginRuntime
  ): Promise<void> {
    runtime.expectedExit = true;
    runtime.desiredState = "stopped";
    runtime.child.kill("SIGKILL");
    await this.waitForChildExit(runtime, this.shutdownGracePeriodMs).catch(
      () => undefined
    );
    this.runtimes.delete(runtime.pluginId);
  }

  private updateSnapshot(
    pluginId: string,
    update: {
      readonly status: PluginRuntimeStatus;
      readonly healthy: boolean;
      readonly processId?: number;
      readonly initializedAt?: string;
      readonly activatedAt?: string;
      readonly restartCount: number;
      readonly lastError?: string;
    }
  ): PluginRuntimeHealthSnapshot {
    const snapshot = pluginRuntimeHealthSnapshotSchema.parse({
      pluginId,
      ...update
    });

    this.snapshots.set(pluginId, snapshot);
    return snapshot;
  }

  private recordHealthyStart(pluginId: string): void {
    this.crashHistory.delete(pluginId);
  }

  private recordCrash(pluginId: string): number {
    const now = Date.now();
    const activeWindow = (
      this.crashHistory.get(pluginId) ?? []
    ).filter((timestamp) => now - timestamp <= this.restartWindowMs);

    activeWindow.push(now);
    this.crashHistory.set(pluginId, activeWindow);
    return activeWindow.length;
  }

  private getRestartCount(pluginId: string): number {
    const now = Date.now();
    return (
      this.crashHistory.get(pluginId)?.filter(
        (timestamp) => now - timestamp <= this.restartWindowMs
      ).length ?? 0
    );
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown plugin runtime error.";
  }
}
