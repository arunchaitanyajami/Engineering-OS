import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApplicationDatabase } from "@engineering-os/database";
import { createLogger } from "@engineering-os/logger";
import {
  PluginRegistryService,
  SqlitePluginRegistryRepository,
  localPluginManifestFileNames
} from "@engineering-os/plugin-registry";
import {
  PluginRuntimeService,
  type PluginRuntimeServiceOptions
} from "@engineering-os/plugin-runtime";

import { PluginLifecycleService } from "../src/plugin-lifecycle-service.js";

const projectRootPath = fileURLToPath(new URL("../../..", import.meta.url));

const createRuntimePluginPackage = async (
  rootDirectory: string,
  options: {
    readonly pluginId?: string;
    readonly backendModuleSource?: string;
    readonly crashMarkerPath?: string;
  } = {}
) => {
  const packageDirectory = await mkdtemp(
    join(rootDirectory, "plugin-lifecycle-")
  );
  const manifest = {
    schemaVersion: "1",
    id: options.pluginId ?? "com.engineering-os.lifecycle-plugin",
    name: "Lifecycle Plugin",
    version: "0.1.0",
    description: "Reference plugin package for lifecycle coordination tests.",
    publisher: {
      name: "Engineering OS"
    },
    engines: {
      engineeringOs: ">=0.1.0"
    },
    entrypoints: {
      backend: "./dist/backend/index.js"
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
        const manifest = ${JSON.stringify(manifest)};

        export default {
          manifest,
          async initialize() {},
          async activate() {},
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

describe("PluginLifecycleService", () => {
  const databases: ApplicationDatabase[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    databases.forEach((database) => database.close());
    databases.length = 0;

    await Promise.all(
      directories.map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
    directories.length = 0;
  });

  const createServices = async (
    options: {
      readonly onBeforeRuntimeSpawn?: PluginRuntimeServiceOptions["onBeforeRuntimeSpawn"];
      readonly restartBackoffMs?: number;
    } = {}
  ) => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-plugin-lifecycle-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);
    const installationsRootPath = join(fixturesDirectory, "managed-plugins");
    const pluginRegistry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "plugin-lifecycle-test" }),
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
          fileURLToPath(
            new URL(
              "../../../packages/plugin-runtime/src/worker.ts",
              import.meta.url
            )
          )
        )};

        runPluginRuntimeWorker();
      `,
      "utf8"
    );

    const pluginRuntime = new PluginRuntimeService({
      pluginResolver: pluginRegistry,
      logger: createLogger({ component: "plugin-lifecycle-test" }),
      worker: {
        entryPointPath: workerWrapperPath,
        execArgv: ["--import", "tsx"],
        cwd: projectRootPath
      },
      restartBackoffMs: options.restartBackoffMs ?? 50,
      ...(options.onBeforeRuntimeSpawn
        ? { onBeforeRuntimeSpawn: options.onBeforeRuntimeSpawn }
        : {})
    });
    const pluginLifecycle = new PluginLifecycleService({
      pluginRegistry,
      pluginRuntime
    });

    return {
      fixturesDirectory,
      pluginRegistry,
      pluginRuntime,
      pluginLifecycle
    };
  };

  it("keeps disable and start atomic under concurrent requests", async () => {
    let releaseStart: () => void = () => undefined;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const {
      fixturesDirectory,
      pluginRegistry,
      pluginRuntime,
      pluginLifecycle
    } = await createServices({
      onBeforeRuntimeSpawn: async () => {
        await startGate;
      }
    });
    const packageDirectory = await createRuntimePluginPackage(
      fixturesDirectory,
      {
        pluginId: "com.engineering-os.lifecycle-race"
      }
    );
    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(packageDirectory);

    await pluginLifecycle.enablePlugin(installedPlugin.pluginId);

    const startPromise = pluginLifecycle.startPlugin(installedPlugin.pluginId);
    const disablePromise = pluginLifecycle.disablePlugin(
      installedPlugin.pluginId
    );

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 75);
    });
    releaseStart();

    const results = await Promise.allSettled([startPromise, disablePromise]);

    expect(results.some((result) => result.status === "fulfilled")).toBe(true);

    const disabledPlugin = pluginRegistry.getInstalledPlugin(
      installedPlugin.pluginId
    );
    expect(disabledPlugin?.enabled).toBe(false);
    expect(
      pluginRuntime.getRuntimeHealth(installedPlugin.pluginId).status
    ).not.toBe("running");
  });

  it("disables a plugin atomically while a restart is pending", async () => {
    const crashMarkerPath = join(tmpdir(), `restart-backoff-${Date.now()}.txt`);
    const {
      fixturesDirectory,
      pluginRegistry,
      pluginRuntime,
      pluginLifecycle
    } = await createServices({
      restartBackoffMs: 250
    });
    directories.push(crashMarkerPath);
    const packageDirectory = await createRuntimePluginPackage(
      fixturesDirectory,
      {
        pluginId: "com.engineering-os.lifecycle-restart",
        backendModuleSource: `
        import { access, writeFile } from "node:fs/promises";

        const manifest = {
          schemaVersion: "1",
          id: "com.engineering-os.lifecycle-restart",
          name: "Lifecycle Plugin",
          version: "0.1.0",
          description: "Reference plugin package for lifecycle coordination tests.",
          publisher: { name: "Engineering OS" },
          engines: { engineeringOs: ">=0.1.0" },
          entrypoints: { backend: "./dist/backend/index.js" },
          capabilities: [],
          permissions: [],
          mcp: []
        };

        const hasMarker = async () => {
          try {
            await access(${JSON.stringify(crashMarkerPath)});
            return true;
          } catch {
            return false;
          }
        };

        export default {
          manifest,
          async initialize() {},
          async activate() {
            if (!(await hasMarker())) {
              await writeFile(${JSON.stringify(crashMarkerPath)}, "crashed", "utf8");
              globalThis.setTimeout(() => {
                process.exit(17);
              }, 50);
            }
          },
          async deactivate() {},
          async dispose() {}
        };
      `
      }
    );
    const installedPlugin =
      await pluginRegistry.registerLocalPluginPackage(packageDirectory);

    await pluginLifecycle.enablePlugin(installedPlugin.pluginId);
    await pluginLifecycle.startPlugin(installedPlugin.pluginId);

    await waitFor(async () => {
      return (
        pluginRuntime.getRuntimeHealth(installedPlugin.pluginId).status ===
        "starting"
      );
    });

    const disabledPlugin = await pluginLifecycle.disablePlugin(
      installedPlugin.pluginId
    );

    expect(disabledPlugin.enabled).toBe(false);

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 350);
    });

    expect(
      pluginRuntime.getRuntimeHealth(installedPlugin.pluginId).status
    ).not.toBe("running");
  });
});
