import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import {
  pluginManifestSchema,
  semanticVersionSchema,
  type PluginManifest
} from "@engineering-os/contracts";
import type { Logger } from "@engineering-os/logger";
import semver from "semver";
import { z } from "zod";

import type {
  InspectedPluginPackage,
  InstalledPlugin,
  PluginPackageSource
} from "./domain.js";
import {
  localPluginManifestFileNames,
  type PluginInstallationState
} from "./domain.js";
import { calculateManagedInstallationHash } from "./integrity.js";
import type { PluginRegistryRepository } from "./repository.js";

const MAX_PLUGIN_MANIFEST_BYTES = 256 * 1024;

const canAccessPath = async (path: string) => {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const validateCompatibleVersion = (
  currentVersion: string,
  manifest: PluginManifest
) => {
  if (semver.satisfies(currentVersion, manifest.engines.engineeringOs)) {
    return;
  }

  throw new PluginRegistryError(
    "PLUGIN_VERSION_INCOMPATIBLE",
    `Plugin '${manifest.id}' requires Engineering OS '${manifest.engines.engineeringOs}' but current version is '${currentVersion}'.`,
    409
  );
};

const parsePluginManifest = (
  serializedManifest: string,
  manifestPath: string
): PluginManifest => {
  let parsedManifest: unknown;

  try {
    parsedManifest = JSON.parse(serializedManifest);
  } catch (error) {
    throw new PluginRegistryError(
      "PLUGIN_MANIFEST_INVALID_JSON",
      `Plugin manifest '${manifestPath}' is not valid JSON.`,
      400,
      error
    );
  }

  try {
    return pluginManifestSchema.parse(parsedManifest);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new PluginRegistryError(
        "PLUGIN_MANIFEST_INVALID",
        `Plugin manifest '${manifestPath}' failed validation.`,
        400,
        error
      );
    }

    throw error;
  }
};

const assertPathWithinPackage = (
  packagePath: string,
  candidatePath: string
) => {
  const relativePath = relative(packagePath, candidatePath);

  if (
    relativePath === "" ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  ) {
    return;
  }

  throw new PluginRegistryError(
    "PLUGIN_PATH_ESCAPES_PACKAGE",
    `Resolved plugin path '${candidatePath}' escapes package root '${packagePath}'.`,
    400
  );
};

const validateLocalPluginFiles = async (
  packagePath: string,
  manifest: PluginManifest
) => {
  const resolvedPackageRootPath = await realpath(packagePath);
  const backendEntrypointPath = join(packagePath, manifest.entrypoints.backend);
  const backendEntrypointStats = await stat(backendEntrypointPath).catch(
    () => null
  );

  if (!backendEntrypointStats?.isFile()) {
    throw new PluginRegistryError(
      "PLUGIN_ENTRYPOINT_MISSING",
      `Plugin backend entrypoint '${manifest.entrypoints.backend}' was not found in '${packagePath}'.`,
      400
    );
  }

  const backendEntrypointRealPath = await realpath(backendEntrypointPath);
  assertPathWithinPackage(resolvedPackageRootPath, backendEntrypointRealPath);

  for (const server of manifest.mcp) {
    if (!server.cwd) {
      continue;
    }

    const workingDirectoryPath = join(packagePath, server.cwd);
    const workingDirectoryStats = await stat(workingDirectoryPath).catch(
      () => null
    );

    if (!workingDirectoryStats?.isDirectory()) {
      throw new PluginRegistryError(
        "PLUGIN_MCP_WORKING_DIRECTORY_MISSING",
        `Plugin MCP working directory '${server.cwd}' was not found in '${packagePath}'.`,
        400
      );
    }

    const workingDirectoryRealPath = await realpath(workingDirectoryPath);
    assertPathWithinPackage(resolvedPackageRootPath, workingDirectoryRealPath);
  }
};

const resolveLocalPluginPackageSource = async (
  localPackagePath: string
): Promise<PluginPackageSource> => {
  const normalizedPath = localPackagePath.trim();

  if (!normalizedPath) {
    throw new PluginRegistryError(
      "PLUGIN_PACKAGE_PATH_INVALID",
      "Local plugin package path is required.",
      400
    );
  }

  let resolvedPath: string;

  try {
    resolvedPath = await realpath(normalizedPath);
  } catch (error) {
    throw new PluginRegistryError(
      "PLUGIN_PACKAGE_NOT_FOUND",
      `Local plugin package '${normalizedPath}' was not found.`,
      404,
      error
    );
  }

  const sourceStats = await lstat(normalizedPath).catch(() => null);

  if (sourceStats?.isSymbolicLink()) {
    throw new PluginRegistryError(
      "PLUGIN_PACKAGE_SYMLINK_UNSUPPORTED",
      "Local plugin package directories must not be symbolic links.",
      400
    );
  }

  const resolvedStats = await stat(resolvedPath);

  if (!resolvedStats.isDirectory()) {
    throw new PluginRegistryError(
      "PLUGIN_PACKAGE_PATH_INVALID",
      `Local plugin package '${normalizedPath}' must be a directory.`,
      400
    );
  }

  return {
    type: "local-directory",
    path: resolvedPath
  };
};

const findManifestPath = async (packagePath: string) => {
  for (const manifestFileName of localPluginManifestFileNames) {
    const manifestPath = join(packagePath, manifestFileName);

    if (await canAccessPath(manifestPath)) {
      return manifestPath;
    }
  }

  throw new PluginRegistryError(
    "PLUGIN_MANIFEST_NOT_FOUND",
    `No plugin manifest was found in '${packagePath}'.`,
    400
  );
};

const inspectResolvedPluginPackage = async (
  source: PluginPackageSource
): Promise<InspectedPluginPackage> => {
  const manifestPath = await findManifestPath(source.path);
  const manifestStats = await stat(manifestPath);

  if (manifestStats.size > MAX_PLUGIN_MANIFEST_BYTES) {
    throw new PluginRegistryError(
      "PLUGIN_MANIFEST_TOO_LARGE",
      `Plugin manifest '${manifestPath}' exceeds the allowed size.`,
      413
    );
  }

  const manifest = parsePluginManifest(
    await readFile(manifestPath, "utf8"),
    manifestPath
  );

  await validateLocalPluginFiles(source.path, manifest);

  return {
    source,
    manifestPath,
    manifest
  };
};

const copyDirectoryRejectingSymlinks = async (
  sourcePath: string,
  targetPath: string
): Promise<void> => {
  const sourceStats = await lstat(sourcePath);

  if (sourceStats.isSymbolicLink()) {
    throw new PluginRegistryError(
      "PLUGIN_SYMLINK_UNSUPPORTED",
      `Plugin package path '${sourcePath}' contains an unsupported symbolic link.`,
      400
    );
  }

  if (sourceStats.isDirectory()) {
    await mkdir(targetPath, { recursive: true });

    const entries = await readdir(sourcePath, { withFileTypes: true });

    for (const entry of entries) {
      await copyDirectoryRejectingSymlinks(
        join(sourcePath, entry.name),
        join(targetPath, entry.name)
      );
    }

    return;
  }

  if (sourceStats.isFile()) {
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    return;
  }

  throw new PluginRegistryError(
    "PLUGIN_UNSUPPORTED_FILE_TYPE",
    `Plugin package path '${sourcePath}' contains an unsupported file type.`,
    400
  );
};

const createInstalledPlugin = (
  inspectedPackage: InspectedPluginPackage,
  source: PluginPackageSource,
  installationRootPath: string,
  contentHash: string
): InstalledPlugin => {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    pluginId: inspectedPackage.manifest.id,
    manifest: inspectedPackage.manifest,
    installation: {
      mode: "managed",
      rootPath: installationRootPath,
      contentHash,
      source
    },
    state: "installed" satisfies PluginInstallationState,
    enabled: false,
    installedAt: now,
    updatedAt: now,
    lastError: null
  };
};

export class PluginRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly cause?: unknown
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "PluginRegistryError";
  }
}

export interface PluginRegistryServiceOptions {
  readonly repository: PluginRegistryRepository;
  readonly logger: Logger;
  readonly engineeringOsVersion: string;
  readonly installationsRootPath: string;
}

export class PluginRegistryService {
  private readonly logger: Logger;
  private readonly engineeringOsVersion: string;
  private readonly installationLocks = new Map<string, Promise<void>>();

  constructor(private readonly options: PluginRegistryServiceOptions) {
    this.logger = options.logger.child({
      component: "plugin-registry"
    });
    this.engineeringOsVersion = semanticVersionSchema.parse(
      options.engineeringOsVersion
    );
  }

  async inspectLocalPluginPackage(
    localPackagePath: string
  ): Promise<InspectedPluginPackage> {
    const inspectedPackage = await inspectResolvedPluginPackage(
      await resolveLocalPluginPackageSource(localPackagePath)
    );

    validateCompatibleVersion(
      this.engineeringOsVersion,
      inspectedPackage.manifest
    );
    return inspectedPackage;
  }

  listInstalledPlugins(): readonly InstalledPlugin[] {
    return this.options.repository.findAll();
  }

  getInstalledPlugin(pluginId: string): InstalledPlugin | null {
    return this.options.repository.findByPluginId(pluginId);
  }

  enableInstalledPlugin(pluginId: string): InstalledPlugin {
    return this.updateInstalledPluginEnabled(pluginId, true);
  }

  disableInstalledPlugin(pluginId: string): InstalledPlugin {
    return this.updateInstalledPluginEnabled(pluginId, false);
  }

  private updateInstalledPluginEnabled(
    pluginId: string,
    enabled: boolean
  ): InstalledPlugin {
    const existingPlugin = this.options.repository.findByPluginId(pluginId);

    if (!existingPlugin) {
      throw new PluginRegistryError(
        "PLUGIN_NOT_FOUND",
        `Plugin '${pluginId}' is not registered.`,
        404
      );
    }

    return this.options.repository.updateEnabled(
      pluginId,
      enabled,
      new Date().toISOString()
    );
  }

  private async runWithInstallationLock<T>(
    pluginId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const activeLock =
      this.installationLocks.get(pluginId) ?? Promise.resolve();
    let releaseLock: () => void = () => undefined;
    const queuedLock = activeLock.then(
      () =>
        new Promise<void>((resolve) => {
          releaseLock = resolve;
        })
    );

    this.installationLocks.set(pluginId, queuedLock);
    await activeLock;

    try {
      return await operation();
    } finally {
      releaseLock();

      if (this.installationLocks.get(pluginId) === queuedLock) {
        this.installationLocks.delete(pluginId);
      }
    }
  }

  async registerLocalPluginPackage(
    localPackagePath: string
  ): Promise<InstalledPlugin> {
    const inspectedPackage =
      await this.inspectLocalPluginPackage(localPackagePath);
    return this.runWithInstallationLock(
      inspectedPackage.manifest.id,
      async () => {
        const existingPlugin = this.options.repository.findByPluginId(
          inspectedPackage.manifest.id
        );

        if (existingPlugin) {
          throw new PluginRegistryError(
            "PLUGIN_ALREADY_REGISTERED",
            `Plugin '${inspectedPackage.manifest.id}' is already registered.`,
            409
          );
        }

        const stagingRootPath = join(
          this.options.installationsRootPath,
          ".staging",
          randomUUID()
        );
        const installationRootPath = join(
          this.options.installationsRootPath,
          inspectedPackage.manifest.id,
          inspectedPackage.manifest.version
        );

        await mkdir(dirname(stagingRootPath), { recursive: true });

        let finalPathCreated = false;

        try {
          if (await canAccessPath(installationRootPath)) {
            throw new PluginRegistryError(
              "PLUGIN_INSTALLATION_ALREADY_EXISTS",
              `Managed installation path '${installationRootPath}' already exists.`,
              409
            );
          }

          await copyDirectoryRejectingSymlinks(
            inspectedPackage.source.path,
            stagingRootPath
          );

          const copiedPackage = await inspectResolvedPluginPackage({
            type: "local-directory",
            path: stagingRootPath
          });

          if (
            JSON.stringify(copiedPackage.manifest) !==
            JSON.stringify(inspectedPackage.manifest)
          ) {
            throw new PluginRegistryError(
              "PLUGIN_INSTALLATION_VALIDATION_FAILED",
              "Copied plugin contents did not match the validated source manifest.",
              500
            );
          }

          const contentHash =
            await calculateManagedInstallationHash(stagingRootPath);
          await mkdir(dirname(installationRootPath), { recursive: true });

          try {
            await rename(stagingRootPath, installationRootPath);
          } catch (error) {
            if (await canAccessPath(installationRootPath)) {
              throw new PluginRegistryError(
                "PLUGIN_INSTALLATION_ALREADY_EXISTS",
                `Managed installation path '${installationRootPath}' already exists.`,
                409,
                error
              );
            }

            throw error;
          }

          finalPathCreated = true;

          try {
            const installedPlugin = this.options.repository.save(
              createInstalledPlugin(
                copiedPackage,
                inspectedPackage.source,
                installationRootPath,
                contentHash
              )
            );

            this.logger.info("Registered managed local plugin package.", {
              pluginId: installedPlugin.pluginId,
              version: installedPlugin.manifest.version,
              installRootPath: installedPlugin.installation.rootPath,
              installationMode: installedPlugin.installation.mode
            });

            return installedPlugin;
          } catch (error) {
            this.options.repository.deleteByPluginId(
              inspectedPackage.manifest.id
            );
            await rm(installationRootPath, { recursive: true, force: true });
            throw error;
          }
        } catch (error) {
          if (finalPathCreated) {
            await rm(installationRootPath, { recursive: true, force: true });
            this.options.repository.deleteByPluginId(
              inspectedPackage.manifest.id
            );
          } else {
            await rm(stagingRootPath, { recursive: true, force: true });
          }

          throw error;
        }
      }
    );
  }
}
