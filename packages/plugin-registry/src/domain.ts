import type { PluginManifest } from "@engineering-os/contracts";

export const localPluginManifestFileNames = [
  "engineering-os.plugin.json",
  "plugin-manifest.json"
] as const;

export type PluginInstallationMode = "managed" | "development-link";
export type PluginInstallationState = "installed" | "incompatible" | "removed";

export interface PluginPackageSource {
  readonly type: "local-directory";
  readonly path: string;
}

export interface PluginInstallation {
  readonly mode: PluginInstallationMode;
  readonly rootPath: string;
  readonly contentHash: string;
  readonly source: PluginPackageSource;
}

export interface InstalledPlugin {
  readonly id: string;
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  readonly installation: PluginInstallation;
  readonly state: PluginInstallationState;
  readonly enabled: boolean;
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly lastError: string | null;
}

export interface InspectedPluginPackage {
  readonly source: PluginPackageSource;
  readonly manifestPath: string;
  readonly manifest: PluginManifest;
}
