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

type DesiredRuntimeState = "running" | "stopped";

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
  readonly generation: number;
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
  readonly onBeforeRuntimeSpawn?: (plugin: InstalledPlugin) => Promise<void> | void;
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

const createWorkerEnvironment = (
  overrides: NodeJS.ProcessEnv | undefined
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};

  for (const key of allowlistedEnvironmentKeys) {
    const value = process.env[key];

    if (value) {
      environment[key] = value;
    }
  }

  return {
    ...environment,
    ...overrides
  };
};

export class PluginRuntimeService {
  private readonly logger: Logger;
  private readonly runtimes = new Map<string, ManagedPluginRuntime>();
  private readonly snapshots = new Map<string, PluginRuntimeHealthSnapshot>();
  private readonly crashHistory = new Map<string, number[]>();
  private readonly lifecycleLocks = new Map<string, Promise<void>>();
  private readonly desiredStates = new Map<string, DesiredRuntimeState>();
  private readonly restartTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly generations = new Map<string, number>();
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
    return this.runWithLifecycleLock(pluginId, async () => {
      if (this.runtimes.has(pluginId)) {
        throw new PluginRuntimeError(
          "PLUGIN_RUNTIME_ALREADY_RUNNING",
          `Plugin '${pluginId}' is already running.`,
          409
        );
      }

      this.setDesiredState(pluginId, "running");
      this.clearRestartTimer(pluginId);
      const generation = this.advanceGeneration(pluginId);
      return this.startPluginInternal(pluginId, generation);
    });
  }

  async stopPlugin(pluginId: string): Promise<PluginRuntimeHealthSnapshot> {
    return this.runWithLifecycleLock(pluginId, async () => {
      this.setDesiredState(pluginId, "stopped");
      this.advanceGeneration(pluginId);
      this.clearRestartTimer(pluginId);

      const runtime = this.runtimes.get(pluginId);

      if (!runtime) {
        return this.updateSnapshot(pluginId, {
          status: "stopped",
          healthy: false,
          restartCount: this.getRestartCount(pluginId)
        });
      }

      return this.stopManagedRuntime(runtime);
    });
  }

  async dispose(): Promise<void> {
    const pluginIds = new Set<string>([
      ...this.runtimes.keys(),
      ...this.restartTimers.keys()
    ]);

    await Promise.all(
      [...pluginIds].map((pluginId) =>
        this.stopPlugin(pluginId).catch((error) => {
          this.logger.error("Failed to stop plugin runtime during disposal.", error, {
            pluginId
          });
        })
      )
    );
  }

  private async startPluginInternal(
    pluginId: string,
    generation: number
  ): Promise<PluginRuntimeHealthSnapshot> {
    if (this.getDesiredState(pluginId) !== "running") {
      return this.getRuntimeHealth(pluginId);
    }

    if (this.getGeneration(pluginId) !== generation) {
      return this.getRuntimeHealth(pluginId);
    }

    if (this.runtimes.has(pluginId)) {
      throw new PluginRuntimeError(
        "PLUGIN_RUNTIME_ALREADY_RUNNING",
        `Plugin '${pluginId}' is already running.`,
        409
      );
    }

    const installedPlugin = this.requireRunnableInstalledPlugin(pluginId);
    await this.verifyManagedInstallation(installedPlugin);
    await this.options.onBeforeRuntimeSpawn?.(installedPlugin);

    if (this.getDesiredState(pluginId) !== "running") {
      return this.getRuntimeHealth(pluginId);
    }

    if (this.getGeneration(pluginId) !== generation) {
      return this.getRuntimeHealth(pluginId);
    }

    const runtime = this.createManagedRuntime(pluginId, generation);
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
          expectedContentHash: installedPlugin.installation.contentHash,
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

  private async stopManagedRuntime(
    runtime: ManagedPluginRuntime
  ): Promise<PluginRuntimeHealthSnapshot> {
    runtime.expectedExit = true;
    this.updateSnapshot(runtime.pluginId, {
      status: "stopping",
      healthy: false,
      ...(runtime.child.pid ? { processId: runtime.child.pid } : {}),
      ...(runtime.initializedAt
        ? { initializedAt: runtime.initializedAt }
        : {}),
      ...(runtime.activatedAt ? { activatedAt: runtime.activatedAt } : {}),
      restartCount: this.getRestartCount(runtime.pluginId)
    });

    try {
      await this.sendRequest(
        runtime,
        shutdownPluginRequestSchema.parse({
          protocolVersion: pluginRuntimeProtocolVersion,
          type: "shutdown-plugin",
          requestId: randomUUID(),
          pluginId: runtime.pluginId
        }),
        this.shutdownGracePeriodMs
      );
    } catch (error) {
      runtime.logger.warn("Plugin runtime did not acknowledge shutdown request.", {
        code: error instanceof PluginRuntimeError ? error.code : "UNKNOWN_ERROR"
      });
    }

    const exitedDuringShutdown = await this.waitForChildExit(
      runtime,
      this.shutdownGracePeriodMs
    );

    if (!exitedDuringShutdown) {
      runtime.child.kill("SIGTERM");
    }

    const exitedAfterSigterm =
      exitedDuringShutdown ||
      (await this.waitForChildExit(runtime, this.shutdownGracePeriodMs));

    if (!exitedAfterSigterm) {
      runtime.child.kill("SIGKILL");
    }

    const exitedAfterSigkill =
      exitedAfterSigterm ||
      (await this.waitForChildExit(runtime, this.shutdownGracePeriodMs));

    if (!exitedAfterSigkill) {
      runtime.logger.error("Plugin runtime did not exit after SIGKILL.", undefined, {
        pluginId: runtime.pluginId
      });
      this.runtimes.delete(runtime.pluginId);
      return this.updateSnapshot(runtime.pluginId, {
        status: "failed",
        healthy: false,
        lastError: `Plugin '${runtime.pluginId}' did not exit after forced termination.`,
        restartCount: this.getRestartCount(runtime.pluginId)
      });
    }

    this.runtimes.delete(runtime.pluginId);
    return this.updateSnapshot(runtime.pluginId, {
      status: "stopped",
      healthy: false,
      restartCount: this.getRestartCount(runtime.pluginId)
    });
  }

  private requireRunnableInstalledPlugin(pluginId: string): InstalledPlugin {
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

    if (!installedPlugin.enabled) {
      throw new PluginRuntimeError(
        "PLUGIN_RUNTIME_PLUGIN_DISABLED",
        `Plugin '${pluginId}' is disabled.`,
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

  private createManagedRuntime(
    pluginId: string,
    generation: number
  ): ManagedPluginRuntime {
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
        env: createWorkerEnvironment(this.options.worker.env),
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
      generation,
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

    if (runtime.expectedExit && this.getDesiredState(runtime.pluginId) === "stopped") {
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

    if (this.getDesiredState(runtime.pluginId) !== "running") {
      return;
    }

    if (restartCount >= this.maxRestartsPerWindow) {
      this.setDesiredState(runtime.pluginId, "stopped");
      this.clearRestartTimer(runtime.pluginId);
      return;
    }

    this.scheduleRestart(runtime.pluginId, runtime.generation, errorMessage);
  }

  private scheduleRestart(
    pluginId: string,
    generation: number,
    errorMessage: string
  ) {
    this.clearRestartTimer(pluginId);
    this.updateSnapshot(pluginId, {
      status: "starting",
      healthy: false,
      lastError: errorMessage,
      restartCount: this.getRestartCount(pluginId)
    });

    const restartTimer = globalThis.setTimeout(() => {
      this.restartTimers.delete(pluginId);

      if (this.getDesiredState(pluginId) !== "running") {
        return;
      }

      if (this.getGeneration(pluginId) !== generation) {
        return;
      }

      void this.runWithLifecycleLock(pluginId, async () => {
        if (this.getDesiredState(pluginId) !== "running") {
          return;
        }

        if (this.getGeneration(pluginId) !== generation) {
          return;
        }

        if (this.runtimes.has(pluginId)) {
          return;
        }

        await this.startPluginInternal(pluginId, generation);
      }).catch((restartError) => {
        this.updateSnapshot(pluginId, {
          status: "failed",
          healthy: false,
          lastError: this.toErrorMessage(restartError),
          restartCount: this.getRestartCount(pluginId)
        });
      });
    }, this.restartBackoffMs);

    this.restartTimers.set(pluginId, restartTimer);
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

  private async waitForChildExit(
    runtime: ManagedPluginRuntime,
    timeoutMs: number
  ): Promise<boolean> {
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
      return true;
    }

    return new Promise((resolve) => {
      const timeout = globalThis.setTimeout(() => {
        resolve(false);
      }, timeoutMs);

      runtime.child.once("exit", () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  }

  private async forceCleanupRuntime(
    runtime: ManagedPluginRuntime
  ): Promise<void> {
    runtime.expectedExit = true;
    this.setDesiredState(runtime.pluginId, "stopped");
    this.clearRestartTimer(runtime.pluginId);
    runtime.child.kill("SIGKILL");
    await this.waitForChildExit(runtime, this.shutdownGracePeriodMs);
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

  private setDesiredState(pluginId: string, desiredState: DesiredRuntimeState) {
    this.desiredStates.set(pluginId, desiredState);
  }

  private getDesiredState(pluginId: string): DesiredRuntimeState {
    return this.desiredStates.get(pluginId) ?? "stopped";
  }

  private clearRestartTimer(pluginId: string) {
    const restartTimer = this.restartTimers.get(pluginId);

    if (!restartTimer) {
      return;
    }

    clearTimeout(restartTimer);
    this.restartTimers.delete(pluginId);
  }

  private advanceGeneration(pluginId: string): number {
    const nextGeneration = (this.generations.get(pluginId) ?? 0) + 1;
    this.generations.set(pluginId, nextGeneration);
    return nextGeneration;
  }

  private getGeneration(pluginId: string): number {
    return this.generations.get(pluginId) ?? 0;
  }

  private async runWithLifecycleLock<T>(
    pluginId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const activeLock = this.lifecycleLocks.get(pluginId) ?? Promise.resolve();
    let releaseLock: () => void = () => undefined;
    const queuedLock = activeLock.then(
      () =>
        new Promise<void>((resolve) => {
          releaseLock = resolve;
        })
    );

    this.lifecycleLocks.set(pluginId, queuedLock);
    await activeLock;

    try {
      return await operation();
    } finally {
      releaseLock();

      if (this.lifecycleLocks.get(pluginId) === queuedLock) {
        this.lifecycleLocks.delete(pluginId);
      }
    }
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown plugin runtime error.";
  }
}
