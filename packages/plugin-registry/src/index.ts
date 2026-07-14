import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { pluginManifestSchema, type PluginManifest } from "@engineering-os/contracts";
import {
  type ApplicationDatabase,
  type InstalledPluginRecord
} from "@engineering-os/database";
import type { Logger } from "@engineering-os/logger";
import semver from "semver";
import { z } from "zod";

const localPluginManifestFileNames = [
  "engineering-os.plugin.json",
  "plugin-manifest.json"
] as const;

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

const resolveLocalPluginPaths = async (
  localPackagePath: string
): Promise<{
  readonly packagePath: string;
  readonly manifestPath: string;
}> => {
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

  const pathStats = await stat(resolvedPath);

  if (pathStats.isFile()) {
    return {
      packagePath: dirname(resolvedPath),
      manifestPath: resolvedPath
    };
  }

  if (!pathStats.isDirectory()) {
    throw new PluginRegistryError(
      "PLUGIN_PACKAGE_PATH_INVALID",
      `Local plugin package '${normalizedPath}' must be a directory or manifest file.`,
      400
    );
  }

  for (const manifestFileName of localPluginManifestFileNames) {
    const manifestPath = join(resolvedPath, manifestFileName);

    if (await canAccessPath(manifestPath)) {
      return {
        packagePath: resolvedPath,
        manifestPath
      };
    }
  }

  throw new PluginRegistryError(
    "PLUGIN_MANIFEST_NOT_FOUND",
    `No plugin manifest was found in '${resolvedPath}'.`,
    400
  );
};

const validateLocalPluginFiles = async (
  packagePath: string,
  manifest: PluginManifest
) => {
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
  }
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

export interface DiscoveredLocalPluginPackage {
  readonly packagePath: string;
  readonly manifestPath: string;
  readonly manifest: PluginManifest;
}

export interface PluginRegistryServiceOptions {
  readonly database: ApplicationDatabase;
  readonly logger: Logger;
  readonly engineeringOsVersion: string;
}

export class PluginRegistryService {
  private readonly logger: Logger;

  constructor(private readonly options: PluginRegistryServiceOptions) {
    this.logger = options.logger.child({
      component: "plugin-registry"
    });
  }

  async discoverLocalPluginPackage(
    localPackagePath: string
  ): Promise<DiscoveredLocalPluginPackage> {
    const { packagePath, manifestPath } =
      await resolveLocalPluginPaths(localPackagePath);
    const serializedManifest = await readFile(manifestPath, "utf8");
    const manifest = parsePluginManifest(serializedManifest, manifestPath);

    validateCompatibleVersion(this.options.engineeringOsVersion, manifest);
    await validateLocalPluginFiles(packagePath, manifest);

    return {
      packagePath,
      manifestPath,
      manifest
    };
  }

  listInstalledPlugins(): readonly InstalledPluginRecord[] {
    return this.options.database.listInstalledPlugins();
  }

  async registerLocalPluginPackage(
    localPackagePath: string
  ): Promise<InstalledPluginRecord> {
    const discoveredPackage =
      await this.discoverLocalPluginPackage(localPackagePath);
    const existingPlugin = this.options.database.getInstalledPlugin(
      discoveredPackage.manifest.id
    );

    if (existingPlugin) {
      throw new PluginRegistryError(
        "PLUGIN_ALREADY_REGISTERED",
        `Plugin '${discoveredPackage.manifest.id}' is already registered.`,
        409
      );
    }

    const now = new Date().toISOString();
    const installedPlugin = this.options.database.registerInstalledPlugin({
      id: randomUUID(),
      pluginId: discoveredPackage.manifest.id,
      name: discoveredPackage.manifest.name,
      version: discoveredPackage.manifest.version,
      description: discoveredPackage.manifest.description,
      installPath: discoveredPackage.packagePath,
      manifest: discoveredPackage.manifest,
      state: "installed",
      enabled: false,
      installedAt: now,
      updatedAt: now
    });

    this.logger.info("Registered local plugin package.", {
      pluginId: installedPlugin.pluginId,
      version: installedPlugin.version,
      installPath: installedPlugin.installPath
    });

    return installedPlugin;
  }
}

export { localPluginManifestFileNames };
