import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  pluginManifestSchema,
  type PluginManifest
} from "@engineering-os/contracts";
import {
  activatePluginRequestSchema,
  initializePluginRequestSchema,
  pluginRuntimeProtocolVersion,
  type PluginRuntimeProtocolVersion
} from "@engineering-os/contracts/unstable-runtime";

const repositoryRootPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

export const milestone2ReferencePluginIds = {
  example: "com.engineering-os.example",
  exampleMcp: "com.engineering-os.example-mcp"
} as const;

export const milestone2ReferencePluginPaths = {
  example: join(repositoryRootPath, "plugins/example-plugin"),
  exampleMcp: join(repositoryRootPath, "plugins/example-mcp-plugin")
} as const;

export type Milestone2ReferencePluginName = keyof typeof milestone2ReferencePluginPaths;

const manifestFileName = "engineering-os.plugin.json";

export const readReferencePluginManifest = (
  pluginName: Milestone2ReferencePluginName
): PluginManifest => {
  const manifestPath = join(
    milestone2ReferencePluginPaths[pluginName],
    manifestFileName
  );

  return pluginManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );
};

export const createInitializePluginRequestFixture = (
  manifest: PluginManifest,
  options: {
    readonly installationRootPath?: string;
    readonly expectedContentHash?: string;
  } = {}
) =>
  initializePluginRequestSchema.parse({
    protocolVersion: pluginRuntimeProtocolVersion,
    type: "initialize-plugin",
    requestId: "contract-fixture-initialize",
    pluginId: manifest.id,
    installationRootPath:
      options.installationRootPath ?? "/tmp/example-plugin",
    expectedContentHash:
      options.expectedContentHash ??
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    manifest
  });

export const createActivatePluginRequestFixture = (
  pluginId: string
) =>
  activatePluginRequestSchema.parse({
    protocolVersion: pluginRuntimeProtocolVersion,
    type: "activate-plugin",
    requestId: "contract-fixture-activate",
    pluginId
  });

export const currentPluginRuntimeProtocolVersion: PluginRuntimeProtocolVersion =
  pluginRuntimeProtocolVersion;
