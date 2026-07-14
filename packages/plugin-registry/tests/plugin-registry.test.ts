import {
  access,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApplicationDatabase } from "@engineering-os/database";
import { createLogger } from "@engineering-os/logger";
import {
  calculateManagedInstallationHash,
  PluginRegistryService,
  SqlitePluginRegistryRepository,
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
  const packageDirectory = await mkdtemp(
    join(rootDirectory, "plugin-package-")
  );
  const backendEntrypoint =
    options.backendEntrypoint ?? "./dist/backend/index.js";
  const manifestFileName =
    options.manifestFileName ?? localPluginManifestFileNames[0];

  await mkdir(join(packageDirectory, "dist/backend"), { recursive: true });
  await writeFile(
    join(packageDirectory, "dist/backend/index.js"),
    "export {};\n"
  );
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
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-plugin-registry-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);
    const installationsRootPath = join(fixturesDirectory, "managed-plugins");

    const registry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0",
      installationsRootPath
    });
    const packageDirectory = await createLocalPluginPackage(fixturesDirectory);

    const registeredPlugin =
      await registry.registerLocalPluginPackage(packageDirectory);

    expect(registeredPlugin).toMatchObject({
      pluginId: "com.engineering-os.filesystem",
      manifest: expect.objectContaining({
        name: "Filesystem Plugin",
        version: "0.1.0"
      }),
      installation: expect.objectContaining({
        mode: "managed",
        source: {
          type: "local-directory",
          path: await realpath(packageDirectory)
        }
      }),
      state: "installed",
      enabled: false
    });
    await expect(
      readFile(
        join(
          registeredPlugin.installation.rootPath,
          "engineering-os.plugin.json"
        ),
        "utf8"
      )
    ).resolves.toContain('"schemaVersion": "1"');
    expect(registry.listInstalledPlugins()).toHaveLength(1);
  });

  it("rejects plugin packages that are incompatible with the current app version", async () => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-plugin-registry-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);
    const installationsRootPath = join(fixturesDirectory, "managed-plugins");

    const registry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0",
      installationsRootPath
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
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-plugin-registry-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);
    const installationsRootPath = join(fixturesDirectory, "managed-plugins");

    const registry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0",
      installationsRootPath
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
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-plugin-registry-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);
    const installationsRootPath = join(fixturesDirectory, "managed-plugins");

    const registry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0",
      installationsRootPath
    });
    const firstPackageDirectory = await createLocalPluginPackage(
      fixturesDirectory,
      {
        id: "com.engineering-os.github"
      }
    );
    const secondPackageDirectory = await createLocalPluginPackage(
      fixturesDirectory,
      {
        id: "com.engineering-os.github",
        manifestFileName: "plugin-manifest.json"
      }
    );

    await registry.registerLocalPluginPackage(firstPackageDirectory);

    await expect(
      registry.registerLocalPluginPackage(secondPackageDirectory)
    ).rejects.toMatchObject({
      code: "PLUGIN_ALREADY_REGISTERED",
      statusCode: 409
    });
  });

  it("copies managed plugin contents so the source can be removed after registration", async () => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-plugin-registry-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);
    const installationsRootPath = join(fixturesDirectory, "managed-plugins");

    const registry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0",
      installationsRootPath
    });
    const packageDirectory = await createLocalPluginPackage(fixturesDirectory, {
      id: "com.engineering-os.confluence"
    });

    const registeredPlugin =
      await registry.registerLocalPluginPackage(packageDirectory);

    await rm(packageDirectory, { recursive: true, force: true });

    await expect(access(registeredPlugin.installation.rootPath)).resolves.toBe(
      undefined
    );
    await expect(
      readFile(
        join(registeredPlugin.installation.rootPath, "dist/backend/index.js"),
        "utf8"
      )
    ).resolves.toContain("export {}");
  });

  it("cleans up staged and final installation paths when copy fails", async () => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-plugin-registry-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);
    const installationsRootPath = join(fixturesDirectory, "managed-plugins");

    const registry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0",
      installationsRootPath
    });
    const packageDirectory = await createLocalPluginPackage(fixturesDirectory, {
      id: "com.engineering-os.slack"
    });
    const symlinkPath = join(packageDirectory, "dist/backend/unsafe-link.js");

    await symlink(join(packageDirectory, "dist/backend/index.js"), symlinkPath);

    await expect(
      registry.registerLocalPluginPackage(packageDirectory)
    ).rejects.toMatchObject({
      code: "PLUGIN_SYMLINK_UNSUPPORTED",
      statusCode: 400
    });

    await expect(
      access(join(installationsRootPath, "com.engineering-os.slack", "0.1.0"))
    ).rejects.toThrow();
    await expect(
      readdir(join(installationsRootPath, ".staging"))
    ).resolves.toEqual([]);
    expect(
      new SqlitePluginRegistryRepository(database).findByPluginId(
        "com.engineering-os.slack"
      )
    ).toBeNull();
  });

  it("serializes concurrent registration for the same plugin id", async () => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-plugin-registry-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);
    const installationsRootPath = join(fixturesDirectory, "managed-plugins");

    const registry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0",
      installationsRootPath
    });
    const packageDirectory = await createLocalPluginPackage(fixturesDirectory, {
      id: "com.engineering-os.jira"
    });

    const results = await Promise.allSettled([
      registry.registerLocalPluginPackage(packageDirectory),
      registry.registerLocalPluginPackage(packageDirectory)
    ]);

    const fulfilledResults = results.filter(
      (result) => result.status === "fulfilled"
    );
    const rejectedResults = results.filter(
      (result) => result.status === "rejected"
    );

    expect(fulfilledResults).toHaveLength(1);
    expect(rejectedResults).toHaveLength(1);
    expect(rejectedResults[0]?.reason).toMatchObject({
      code: "PLUGIN_ALREADY_REGISTERED",
      statusCode: 409
    });

    const installedPlugins = registry.listInstalledPlugins();

    expect(installedPlugins).toHaveLength(1);
    expect(installedPlugins[0]).toBeDefined();
    expect(installedPlugins[0]?.pluginId).toBe("com.engineering-os.jira");
    await expect(
      access(installedPlugins[0]!.installation.rootPath)
    ).resolves.toBe(undefined);
    await expect(
      calculateManagedInstallationHash(
        installedPlugins[0]!.installation.rootPath
      )
    ).resolves.toBe(installedPlugins[0]!.installation.contentHash);
  });

  it("updates the enabled state for an installed plugin", async () => {
    const fixturesDirectory = await mkdtemp(
      join(tmpdir(), "engineering-os-plugin-registry-")
    );
    directories.push(fixturesDirectory);

    const database = new ApplicationDatabase(":memory:");
    database.runMigrations();
    databases.push(database);
    const installationsRootPath = join(fixturesDirectory, "managed-plugins");

    const registry = new PluginRegistryService({
      repository: new SqlitePluginRegistryRepository(database),
      logger: createLogger({ component: "plugin-registry-test" }),
      engineeringOsVersion: "0.1.0",
      installationsRootPath
    });
    const packageDirectory = await createLocalPluginPackage(fixturesDirectory, {
      id: "com.engineering-os.enablement"
    });

    await registry.registerLocalPluginPackage(packageDirectory);

    const enabledPlugin = registry.enableInstalledPlugin(
      "com.engineering-os.enablement"
    );
    expect(enabledPlugin.enabled).toBe(true);

    const disabledPlugin = registry.disableInstalledPlugin(
      "com.engineering-os.enablement"
    );
    expect(disabledPlugin.enabled).toBe(false);
  });
});
