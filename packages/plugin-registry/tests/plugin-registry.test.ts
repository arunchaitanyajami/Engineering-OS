import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApplicationDatabase } from "@engineering-os/database";
import { createLogger } from "@engineering-os/logger";
import {
  PluginRegistryService,
  localPluginManifestFileNames
} from "@engineering-os/plugin-registry";

const createLocalPluginPackage = async (
  rootDirectory: string,
  options: {
    readonly id?: string;
    readonly version?: string;
    readonly engineeringOsRange?: string;
    readonly backendEntrypoint?: string;
    readonly manifestFileName?: (typeof localPluginManifestFileNames)[number];
  } = {}
) => {
  const packageDirectory = await mkdtemp(join(rootDirectory, "plugin-package-"));
  const backendEntrypoint = options.backendEntrypoint ?? "./dist/backend/index.js";
  const manifestFileName =
    options.manifestFileName ?? localPluginManifestFileNames[0];

  await mkdir(join(packageDirectory, "dist/backend"), { recursive: true });
  await writeFile(join(packageDirectory, "dist/backend/index.js"), "export {};\n");
  await writeFile(
    join(packageDirectory, manifestFileName),
    JSON.stringify(
      {
        schemaVersion: "1",
        id: options.id ?? "com.engineering-os.filesystem",
        name: "Filesystem Plugin",
        version: options.version ?? "0.1.0",
        description: "Reference local plugin package for registry validation.",
        publisher: {
          name: "Engineering OS"
        },
        engines: {
          engineeringOs: options.engineeringOsRange ?? ">=0.1.0"
        },
        entrypoints: {
          backend: backendEntrypoint
        },
        capabilities: [],
        permissions: [],
        mcp: []
      },
      null,
      2
    ),
    "utf8"
  );

  return packageDirectory;
};

describe("PluginRegistryService", () => {
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

  it("discovers and registers a valid local plugin package", async () => {
    const fixturesDirectory = await mkdtemp(join(tmpdir(), "engineering-os-plugin-registry-"));
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);

    const registry = new PluginRegistryService({
      database,
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0"
    });
    const packageDirectory = await createLocalPluginPackage(fixturesDirectory);
    const resolvedPackageDirectory = await realpath(packageDirectory);

    const registeredPlugin =
      await registry.registerLocalPluginPackage(packageDirectory);

    expect(registeredPlugin).toMatchObject({
      pluginId: "com.engineering-os.filesystem",
      name: "Filesystem Plugin",
      version: "0.1.0",
      installPath: resolvedPackageDirectory,
      state: "installed",
      enabled: false
    });
    expect(registry.listInstalledPlugins()).toHaveLength(1);
  });

  it("rejects plugin packages that are incompatible with the current app version", async () => {
    const fixturesDirectory = await mkdtemp(join(tmpdir(), "engineering-os-plugin-registry-"));
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);

    const registry = new PluginRegistryService({
      database,
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0"
    });
    const packageDirectory = await createLocalPluginPackage(fixturesDirectory, {
      engineeringOsRange: ">=0.2.0"
    });

    await expect(
      registry.registerLocalPluginPackage(packageDirectory)
    ).rejects.toMatchObject({
      code: "PLUGIN_VERSION_INCOMPATIBLE",
      statusCode: 409
    });
  });

  it("rejects plugin packages whose backend entrypoint is missing", async () => {
    const fixturesDirectory = await mkdtemp(join(tmpdir(), "engineering-os-plugin-registry-"));
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);

    const registry = new PluginRegistryService({
      database,
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0"
    });
    const packageDirectory = await createLocalPluginPackage(fixturesDirectory, {
      backendEntrypoint: "./dist/backend/missing.js"
    });

    await expect(
      registry.registerLocalPluginPackage(packageDirectory)
    ).rejects.toMatchObject({
      code: "PLUGIN_ENTRYPOINT_MISSING",
      statusCode: 400
    });
  });

  it("rejects duplicate plugin registrations by plugin id", async () => {
    const fixturesDirectory = await mkdtemp(join(tmpdir(), "engineering-os-plugin-registry-"));
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);

    const registry = new PluginRegistryService({
      database,
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0"
    });
    const firstPackageDirectory = await createLocalPluginPackage(fixturesDirectory, {
      id: "com.engineering-os.github"
    });
    const secondPackageDirectory = await createLocalPluginPackage(fixturesDirectory, {
      id: "com.engineering-os.github",
      manifestFileName: "plugin-manifest.json"
    });

    await registry.registerLocalPluginPackage(firstPackageDirectory);

    await expect(
      registry.registerLocalPluginPackage(secondPackageDirectory)
    ).rejects.toMatchObject({
      code: "PLUGIN_ALREADY_REGISTERED",
      statusCode: 409
    });
  });
});
