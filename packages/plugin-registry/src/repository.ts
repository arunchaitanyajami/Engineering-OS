import { pluginManifestSchema } from "@engineering-os/contracts";
import {
  ApplicationDatabase,
  readOptionalString,
  readRequiredBoolean
} from "@engineering-os/database";
import { z } from "zod";

import type {
  InstalledPlugin,
  PluginInstallationMode,
  PluginInstallationState
} from "./domain.js";

const installationModeSchema = z.enum(["managed", "development-link"]);
const installationStateSchema = z.enum(["installed", "incompatible", "removed"]);
const pluginSourceTypeSchema = z.literal("local-directory");

const readRequiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string") {
    throw new Error(`Expected '${fieldName}' to be a string.`);
  }

  return value;
};

const mapInstalledPluginRow = (row: Record<string, unknown>): InstalledPlugin => {
  const serializedManifest = readRequiredString(row.manifest_json, "manifest_json");
  const parsedManifest = pluginManifestSchema.parse(JSON.parse(serializedManifest));
  const pluginId = readRequiredString(row.plugin_id, "plugin_id");

  if (pluginId !== parsedManifest.id) {
    throw new Error(
      `Installed plugin row '${readRequiredString(row.id, "id")}' does not match its manifest plugin id.`
    );
  }

  return {
    id: readRequiredString(row.id, "id"),
    pluginId,
    manifest: parsedManifest,
    installation: {
      mode: installationModeSchema.parse(row.installation_mode),
      rootPath: readRequiredString(row.install_root_path, "install_root_path"),
      contentHash: readRequiredString(row.content_hash, "content_hash"),
      source: {
        type: pluginSourceTypeSchema.parse(row.source_type),
        path: readRequiredString(row.source_path, "source_path")
      }
    },
    state: installationStateSchema.parse(
      row.state
    ) as PluginInstallationState,
    enabled: readRequiredBoolean(row.enabled, "enabled"),
    installedAt: readRequiredString(row.installed_at, "installed_at"),
    updatedAt: readRequiredString(row.updated_at, "updated_at"),
    lastError: readOptionalString(row.last_error, "last_error")
  };
};

export interface PluginRegistryRepository {
  findAll(): readonly InstalledPlugin[];
  findByPluginId(pluginId: string): InstalledPlugin | null;
  save(plugin: InstalledPlugin): InstalledPlugin;
  deleteByPluginId(pluginId: string): void;
}

export class SqlitePluginRegistryRepository
  implements PluginRegistryRepository
{
  constructor(private readonly database: ApplicationDatabase) {}

  findAll(): readonly InstalledPlugin[] {
    return this.database
      .queryAll(
        `
          SELECT
            id,
            plugin_id,
            install_root_path,
            installation_mode,
            source_type,
            source_path,
            content_hash,
            manifest_json,
            state,
            enabled,
            installed_at,
            updated_at,
            last_error
          FROM installed_plugins
          ORDER BY updated_at DESC, plugin_id ASC
        `
      )
      .map(mapInstalledPluginRow);
  }

  findByPluginId(pluginId: string): InstalledPlugin | null {
    const row = this.database.queryFirst(
      `
        SELECT
          id,
          plugin_id,
          install_root_path,
          installation_mode,
          source_type,
          source_path,
          content_hash,
          manifest_json,
          state,
          enabled,
          installed_at,
          updated_at,
          last_error
        FROM installed_plugins
        WHERE plugin_id = ?
      `,
      [pluginId]
    );

    return row ? mapInstalledPluginRow(row) : null;
  }

  save(plugin: InstalledPlugin): InstalledPlugin {
    this.database.execute(
      `
        INSERT INTO installed_plugins (
          id,
          plugin_id,
          install_root_path,
          installation_mode,
          source_type,
          source_path,
          content_hash,
          manifest_json,
          state,
          enabled,
          installed_at,
          updated_at,
          last_error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        plugin.id,
        plugin.pluginId,
        plugin.installation.rootPath,
        plugin.installation.mode satisfies PluginInstallationMode,
        plugin.installation.source.type,
        plugin.installation.source.path,
        plugin.installation.contentHash,
        JSON.stringify(plugin.manifest),
        plugin.state,
        plugin.enabled ? 1 : 0,
        plugin.installedAt,
        plugin.updatedAt,
        plugin.lastError
      ]
    );

    const persistedPlugin = this.findByPluginId(plugin.pluginId);

    if (!persistedPlugin) {
      throw new Error(
        `Installed plugin '${plugin.pluginId}' could not be read after insert.`
      );
    }

    return persistedPlugin;
  }

  deleteByPluginId(pluginId: string): void {
    this.database.execute("DELETE FROM installed_plugins WHERE plugin_id = ?", [
      pluginId
    ]);
  }
}
