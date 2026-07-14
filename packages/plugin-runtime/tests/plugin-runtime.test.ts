import { fileURLToPath } from "node:url";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApplicationDatabase } from "@engineering-os/database";
import { createLogger } from "@engineering-os/logger";
import {
  type InstalledPlugin,
  PluginRegistryService,
  SqlitePluginRegistryRepository,
  localPluginManifestFileNames
} from "@engineering-os/plugin-registry";
import { PluginRuntimeService } from "@engineering-os/plugin-runtime";

const projectRootPath = fileURLToPath(new URL("../../..", import.meta.url));

const createRuntimePluginPackage = async (
  rootDirectory: string,
  options: {
    readonly pluginId?: string;
    readonly version?: string;
    readonly crashMarkerPath?: string;
    readonly backendModuleSource?: string;
  } = {}
) => {
  const packageDirectory = await mkdtemp(
    join(rootDirectory, "plugin-runtime-")
  );
  const pluginId = options.pluginId ?? "com.engineering-os.runtime-example";
  const version = options.version ?? "0.1.0";
  const backendEntrypoint = "./dist/backend/index.js";
  const manifest = {
    schemaVersion: "1",
    id: pluginId,
    name: "Runtime Example Plugin",
    version,
    description: "Reference plugin package for runtime supervision tests.",
    publisher: {
      name: "Engineering OS"
    },
    engines: {
      engineeringOs: ">=0.1.0"
    },
    entrypoints: {
      backend: backendEntrypoint
    },
    capabilities: [],
    permissions: [],
    mcp: []
  };

  await mkdir(join(packageDirectory, "dist/backend"), { recursive: true });
  await writeFile(
    join(packageDirectory, localPluginManifestFileNames[0]),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
  await writeFile(
    join(packageDirectory, "dist/backend/index.js"),
    options.backendModuleSource ??
      `
      import { access, writeFile } from "node:fs/promises";

      const manifest = ${JSON.stringify(manifest)};
      const crashMarkerPath = ${JSON.stringify(options.crashMarkerPath ?? null)};

      const hasMarker = async (path) => {
        try {
          await access(path);
          return true;
        } catch {
          return false;
        }
      };

      export default {
        manifest,
        async initialize(context) {
          context.logger.info("plugin initialized");
        },
        async activate() {
          if (crashMarkerPath && !(await hasMarker(crashMarkerPath))) {
            await writeFile(crashMarkerPath, "crashed-once", "utf8");
            globalThis.setTimeout(() => {
              process.exit(17);
            }, 150);
          }
        },
        async deactivate() {},
        async dispose() {}
      };
    `,
    "utf8"
  );

  return packageDirectory;
};

const waitFor = async (
  predicate: () => Promise<boolean>,
  timeoutMs = 2_500
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 25);
    });
  }

  throw new Error("Condition was not satisfied before the timeout.");
};

describe("PluginRuntimeService", () => {
  const databases: ApplicationDatabase[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      databases.map(async (database) => {
        database.close();
      })
    );
    databases.length = 0;

    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
    directories.length = 0;
  });

  const createRuntime = async (
    options: {
      readonly restartBackoffMs?: number;
      readonly maxRestartsPerWindow?: number;
      readonly workerEnv?: NodeJS.ProcessEnv;
      readonly onBeforeRuntimeSpawn?: (
        plugin: InstalledPlugin
      ) => Promise<void> | void;
      readonly onBeforeRestartLifecycleAcquire?: (
        pluginId: string
      ) => Promise<void> | void;
    } = {}
  ) => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-plugin-runtime-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);
    const installationsRootPath = join(fixturesDirectory, "managed-plugins");
    const registry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "plugin-runtime-test" }),
      engineeringOsVersion: "0.1.0",
      installationsRootPath
    });
    const workerWrapperPath = join(
      fixturesDirectory,
      "plugin-runtime-worker-wrapper.ts"
    );

    await writeFile(
      workerWrapperPath,
      `
        import { runPluginRuntimeWorker } from ${JSON.stringify(
          fileURLToPath(new URL("../src/worker.ts", import.meta.url))
        )};

        runPluginRuntimeWorker();
      `,
      "utf8"
    );

    const runtime = new PluginRuntimeService({
      pluginResolver: registry,
      logger: createLogger({ component: "plugin-runtime-test" }),
      worker: {
        entryPointPath: workerWrapperPath,
        execArgv: ["--import", "tsx"],
        cwd: projectRootPath,
        ...(options.workerEnv ? { env: options.workerEnv } : {})
      },
      restartBackoffMs: options.restartBackoffMs ?? 50,
      maxRestartsPerWindow: options.maxRestartsPerWindow ?? 3,
      ...(options.onBeforeRuntimeSpawn
        ? { onBeforeRuntimeSpawn: options.onBeforeRuntimeSpawn }
        : {}),
      ...(options.onBeforeRestartLifecycleAcquire
        ? {
            onBeforeRestartLifecycleAcquire:
              options.onBeforeRestartLifecycleAcquire
          }
        : {})
    });

    return {
      fixturesDirectory,
      registry,
      runtime
    };
  };

  const registerEnabledPlugin = async (
    registry: PluginRegistryService,
    packageDirectory: string
  ) => {
    const installedPlugin =
      await registry.registerLocalPluginPackage(packageDirectory);
    return registry.enableInstalledPlugin(installedPlugin.pluginId);
  };

  it("starts and stops a managed plugin through a child runtime process", async () => {
    const { fixturesDirectory, registry, runtime } = await createRuntime();
    const packageDirectory =
      await createRuntimePluginPackage(fixturesDirectory);
    const installedPlugin = await registerEnabledPlugin(
      registry,
      packageDirectory
    );

    const startedRuntime = await runtime.startPlugin(installedPlugin.pluginId);

    expect(startedRuntime).toMatchObject({
      pluginId: installedPlugin.pluginId,
      status: "running",
      healthy: true
    });
    await expect(
      access(
        join(installedPlugin.installation.rootPath, "dist/backend/index.js")
      )
    ).resolves.toBe(undefined);
    await expect(
      readFile(join(packageDirectory, "dist/backend/index.js"), "utf8")
    ).resolves.toContain("plugin initialized");

    const health = await runtime.inspectPluginHealth(installedPlugin.pluginId);

    expect(health).toMatchObject({
      pluginId: installedPlugin.pluginId,
      status: "running",
      healthy: true
    });

    const stoppedRuntime = await runtime.stopPlugin(installedPlugin.pluginId);

    expect(stoppedRuntime).toMatchObject({
      pluginId: installedPlugin.pluginId,
      status: "stopped",
      healthy: false
    });
  });

  it("rejects runtime launch when the managed installation hash no longer matches", async () => {
    const { fixturesDirectory, registry, runtime } = await createRuntime();
    const packageDirectory = await createRuntimePluginPackage(
      fixturesDirectory,
      {
        pluginId: "com.engineering-os.integrity"
      }
    );
    const installedPlugin = await registerEnabledPlugin(
      registry,
      packageDirectory
    );

    await writeFile(
      join(installedPlugin.installation.rootPath, "dist/backend/index.js"),
      "export default {};",
      "utf8"
    );

    await expect(
      runtime.startPlugin(installedPlugin.pluginId)
    ).rejects.toMatchObject({
      code: "PLUGIN_RUNTIME_INTEGRITY_CHECK_FAILED",
      statusCode: 409
    });
  });

  it("rejects launch when the managed installation changes after parent verification but before worker import", async () => {
    let tampered = false;
    const { fixturesDirectory, registry, runtime } = await createRuntime({
      onBeforeRuntimeSpawn: async (installedPlugin) => {
        if (tampered) {
          return;
        }

        tampered = true;
        await writeFile(
          join(installedPlugin.installation.rootPath, "dist/backend/index.js"),
          "export default {};",
          "utf8"
        );
      }
    });
    const packageDirectory = await createRuntimePluginPackage(
      fixturesDirectory,
      {
        pluginId: "com.engineering-os.worker-integrity"
      }
    );
    const installedPlugin = await registerEnabledPlugin(
      registry,
      packageDirectory
    );

    await expect(
      runtime.startPlugin(installedPlugin.pluginId)
    ).rejects.toMatchObject({
      code: "ERROR",
      statusCode: 502
    });
  });

  it("rejects disabled plugins before runtime launch", async () => {
    const { fixturesDirectory, registry, runtime } = await createRuntime();
    const packageDirectory = await createRuntimePluginPackage(
      fixturesDirectory,
      {
        pluginId: "com.engineering-os.disabled-plugin"
      }
    );

    const installedPlugin =
      await registry.registerLocalPluginPackage(packageDirectory);

    await expect(
      runtime.startPlugin(installedPlugin.pluginId)
    ).rejects.toMatchObject({
      code: "PLUGIN_RUNTIME_PLUGIN_DISABLED",
      statusCode: 409
    });
  });

  it("does not pass parent sentinel secrets into child runtime environments", async () => {
    const { fixturesDirectory, registry, runtime } = await createRuntime({
      workerEnv: {
        EOS_RUNTIME_TEST_SENTINEL: undefined
      }
    });
    const visibleValuePath = join(fixturesDirectory, "runtime-env-value.txt");
    const packageDirectory = await createRuntimePluginPackage(
      fixturesDirectory,
      {
        pluginId: "com.engineering-os.env-allowlist",
        backendModuleSource: `
        import { writeFile } from "node:fs/promises";

        const manifest = {
          schemaVersion: "1",
          id: "com.engineering-os.env-allowlist",
          name: "Runtime Example Plugin",
          version: "0.1.0",
          description: "Reference plugin package for runtime supervision tests.",
          publisher: { name: "Engineering OS" },
          engines: { engineeringOs: ">=0.1.0" },
          entrypoints: { backend: "./dist/backend/index.js" },
          capabilities: [],
          permissions: [],
          mcp: []
        };

        export default {
          manifest,
          async initialize() {},
          async activate() {
            await writeFile(
              ${JSON.stringify(visibleValuePath)},
              String(process.env.EOS_RUNTIME_TEST_SENTINEL ?? ""),
              "utf8"
            );
          },
          async deactivate() {},
          async dispose() {}
        };
      `
      }
    );
    const installedPlugin = await registerEnabledPlugin(
      registry,
      packageDirectory
    );

    process.env.EOS_RUNTIME_TEST_SENTINEL = "super-secret-value";
    try {
      await runtime.startPlugin(installedPlugin.pluginId);
    } finally {
      delete process.env.EOS_RUNTIME_TEST_SENTINEL;
    }

    await expect(readFile(visibleValuePath, "utf8")).resolves.toBe("");
    await runtime.stopPlugin(installedPlugin.pluginId);
  });

  it("serializes concurrent start requests for the same plugin", async () => {
    const { fixturesDirectory, registry, runtime } = await createRuntime();
    const packageDirectory = await createRuntimePluginPackage(
      fixturesDirectory,
      {
        pluginId: "com.engineering-os.concurrent-start"
      }
    );
    const installedPlugin = await registerEnabledPlugin(
      registry,
      packageDirectory
    );

    const results = await Promise.allSettled([
      runtime.startPlugin(installedPlugin.pluginId),
      runtime.startPlugin(installedPlugin.pluginId)
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: "PLUGIN_RUNTIME_ALREADY_RUNNING",
      statusCode: 409
    });

    const health = await runtime.inspectPluginHealth(installedPlugin.pluginId);
    expect(health).toMatchObject({
      pluginId: installedPlugin.pluginId,
      status: "running",
      healthy: true
    });

    await runtime.stopPlugin(installedPlugin.pluginId);
  });

  it("cancels a pending restart when stop is called during backoff", async () => {
    const { fixturesDirectory, registry, runtime } = await createRuntime({
      restartBackoffMs: 300
    });
    const crashMarkerPath = join(
      fixturesDirectory,
      "runtime-restart-cancel-marker.txt"
    );
    const packageDirectory = await createRuntimePluginPackage(
      fixturesDirectory,
      {
        pluginId: "com.engineering-os.restart-cancel",
        crashMarkerPath
      }
    );
    const installedPlugin = await registerEnabledPlugin(
      registry,
      packageDirectory
    );

    await runtime.startPlugin(installedPlugin.pluginId);

    await waitFor(async () => {
      const crashedOnce = await access(crashMarkerPath)
        .then(() => true)
        .catch(() => false);
      const health = runtime.getRuntimeHealth(installedPlugin.pluginId);
      return crashedOnce && health.status === "starting";
    });

    const stopped = await runtime.stopPlugin(installedPlugin.pluginId);

    expect(stopped).toMatchObject({
      pluginId: installedPlugin.pluginId,
      status: "stopped",
      healthy: false
    });

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 450);
    });

    const health = runtime.getRuntimeHealth(installedPlugin.pluginId);

    expect(health).toMatchObject({
      pluginId: installedPlugin.pluginId,
      status: "stopped",
      healthy: false
    });
  });

  it("restarts a crashed child runtime within the supervision window", async () => {
    const { fixturesDirectory, registry, runtime } = await createRuntime();
    const crashMarkerPath = join(fixturesDirectory, "runtime-crash-marker.txt");
    const packageDirectory = await createRuntimePluginPackage(
      fixturesDirectory,
      {
        pluginId: "com.engineering-os.restarting-plugin",
        crashMarkerPath
      }
    );
    const installedPlugin = await registerEnabledPlugin(
      registry,
      packageDirectory
    );

    await runtime.startPlugin(installedPlugin.pluginId);

    await waitFor(async () => {
      const restartedAfterCrash = await access(crashMarkerPath)
        .then(() => true)
        .catch(() => false);
      const health = runtime.getRuntimeHealth(installedPlugin.pluginId);
      return restartedAfterCrash && health.status === "running";
    });

    const health = await runtime.inspectPluginHealth(installedPlugin.pluginId);

    expect(health).toMatchObject({
      pluginId: installedPlugin.pluginId,
      status: "running",
      healthy: true
    });

    await runtime.stopPlugin(installedPlugin.pluginId);
  });

  it("stops restarting after repeated crash-loop failures reach the restart budget", async () => {
    const { fixturesDirectory, registry, runtime } = await createRuntime({
      restartBackoffMs: 50,
      maxRestartsPerWindow: 3
    });
    const crashCounterPath = join(
      fixturesDirectory,
      "runtime-crash-loop-count.txt"
    );
    const packageDirectory = await createRuntimePluginPackage(
      fixturesDirectory,
      {
        pluginId: "com.engineering-os.crash-loop",
        backendModuleSource: `
        import { readFile, writeFile } from "node:fs/promises";

        const manifest = {
          schemaVersion: "1",
          id: "com.engineering-os.crash-loop",
          name: "Runtime Example Plugin",
          version: "0.1.0",
          description: "Reference plugin package for runtime supervision tests.",
          publisher: { name: "Engineering OS" },
          engines: { engineeringOs: ">=0.1.0" },
          entrypoints: { backend: "./dist/backend/index.js" },
          capabilities: [],
          permissions: [],
          mcp: []
        };

        const readCrashCount = async () => {
          try {
            return Number(await readFile(${JSON.stringify(crashCounterPath)}, "utf8"));
          } catch {
            return 0;
          }
        };

        export default {
          manifest,
          async initialize() {},
          async activate() {
            const nextCount = (await readCrashCount()) + 1;
            await writeFile(${JSON.stringify(crashCounterPath)}, String(nextCount), "utf8");
            globalThis.setTimeout(() => {
              process.exit(42);
            }, 50);
          },
          async deactivate() {},
          async dispose() {}
        };
      `
      }
    );
    const installedPlugin = await registerEnabledPlugin(
      registry,
      packageDirectory
    );

    await runtime.startPlugin(installedPlugin.pluginId);

    await waitFor(async () => {
      const health = runtime.getRuntimeHealth(installedPlugin.pluginId);
      return health.status === "failed" && health.restartCount >= 3;
    }, 3_500);

    const failedHealth = runtime.getRuntimeHealth(installedPlugin.pluginId);
    expect(failedHealth).toMatchObject({
      pluginId: installedPlugin.pluginId,
      status: "failed",
      healthy: false,
      restartCount: 3
    });

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 300);
    });

    const stableHealth = runtime.getRuntimeHealth(installedPlugin.pluginId);
    expect(stableHealth).toMatchObject({
      pluginId: installedPlugin.pluginId,
      status: "failed",
      healthy: false,
      restartCount: 3
    });
  });

  it("prevents restart transition work from spawning after disposal begins", async () => {
    let releaseRestartAcquire: () => void = () => undefined;
    let restartAcquireEntered = false;
    const restartAcquireGate = new Promise<void>((resolve) => {
      releaseRestartAcquire = resolve;
    });
    const { fixturesDirectory, registry, runtime } = await createRuntime({
      restartBackoffMs: 50,
      onBeforeRestartLifecycleAcquire: async () => {
        restartAcquireEntered = true;
        await restartAcquireGate;
      }
    });
    const crashMarkerPath = join(
      fixturesDirectory,
      "runtime-dispose-restart-marker.txt"
    );
    const packageDirectory = await createRuntimePluginPackage(
      fixturesDirectory,
      {
        pluginId: "com.engineering-os.dispose-restart",
        crashMarkerPath
      }
    );
    const installedPlugin = await registerEnabledPlugin(
      registry,
      packageDirectory
    );

    await runtime.startPlugin(installedPlugin.pluginId);

    await waitFor(async () => {
      const crashedOnce = await access(crashMarkerPath)
        .then(() => true)
        .catch(() => false);
      return crashedOnce && restartAcquireEntered;
    }, 3_000);

    const disposePromise = runtime.dispose();

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 50);
    });

    releaseRestartAcquire();
    await disposePromise;

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 150);
    });

    const runtimeState = runtime as unknown as {
      readonly runtimes: Map<string, unknown>;
      readonly restartTimers: Map<string, unknown>;
    };

    expect(runtimeState.runtimes.size).toBe(0);
    expect(runtimeState.restartTimers.size).toBe(0);
    expect(runtime.getRuntimeHealth(installedPlugin.pluginId)).toMatchObject({
      pluginId: installedPlugin.pluginId,
      status: "stopped",
      healthy: false
    });

    await expect(
      runtime.startPlugin(installedPlugin.pluginId)
    ).rejects.toMatchObject({
      code: "PLUGIN_RUNTIME_DISPOSING",
      statusCode: 503
    });
  });
});
