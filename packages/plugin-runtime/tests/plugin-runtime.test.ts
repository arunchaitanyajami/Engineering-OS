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
  } = {}
) => {
  const packageDirectory = await mkdtemp(join(rootDirectory, "plugin-runtime-"));
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
          await context.storage.set("initialized", true);
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

  const createRuntime = async () => {
    const fixturesDirectory = await mkdtemp(join(tmpdir(), "engineering-os-plugin-runtime-"));
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
    const workerWrapperPath = join(fixturesDirectory, "plugin-runtime-worker-wrapper.ts");

    await writeFile(
      workerWrapperPath,
      `
        import { runPluginRuntimeWorker } from ${JSON.stringify(
          fileURLToPath(
            new URL("../src/worker.ts", import.meta.url)
          )
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
        cwd: projectRootPath
      },
      restartBackoffMs: 50
    });

    return {
      fixturesDirectory,
      registry,
      runtime
    };
  };

  it("starts and stops a managed plugin through a child runtime process", async () => {
    const { fixturesDirectory, registry, runtime } = await createRuntime();
    const packageDirectory = await createRuntimePluginPackage(fixturesDirectory);
    const installedPlugin =
      await registry.registerLocalPluginPackage(packageDirectory);

    const startedRuntime = await runtime.startPlugin(installedPlugin.pluginId);

    expect(startedRuntime).toMatchObject({
      pluginId: installedPlugin.pluginId,
      status: "running",
      healthy: true
    });
    await expect(
      access(join(installedPlugin.installation.rootPath, "dist/backend/index.js"))
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
    const packageDirectory = await createRuntimePluginPackage(fixturesDirectory, {
      pluginId: "com.engineering-os.integrity"
    });
    const installedPlugin =
      await registry.registerLocalPluginPackage(packageDirectory);

    await writeFile(
      join(installedPlugin.installation.rootPath, "dist/backend/index.js"),
      "export default {};",
      "utf8"
    );

    await expect(runtime.startPlugin(installedPlugin.pluginId)).rejects.toMatchObject(
      {
        code: "PLUGIN_RUNTIME_INTEGRITY_CHECK_FAILED",
        statusCode: 409
      }
    );
  });

  it("restarts a crashed child runtime within the supervision window", async () => {
    const { fixturesDirectory, registry, runtime } = await createRuntime();
    const crashMarkerPath = join(fixturesDirectory, "runtime-crash-marker.txt");
    const packageDirectory = await createRuntimePluginPackage(fixturesDirectory, {
      pluginId: "com.engineering-os.restarting-plugin",
      crashMarkerPath
    });
    const installedPlugin =
      await registry.registerLocalPluginPackage(packageDirectory);

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
});
