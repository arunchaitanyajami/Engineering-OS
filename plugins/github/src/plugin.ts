import type {
  EngineeringOsPlugin,
  EngineeringOsPluginContext
} from "@engineering-os/plugin-sdk";

import { githubPluginManifest } from "./manifest.js";

class GitHubEngineeringOsPlugin implements EngineeringOsPlugin {
  readonly manifest = githubPluginManifest;
  #context: EngineeringOsPluginContext | undefined;

  async initialize(context: EngineeringOsPluginContext): Promise<void> {
    this.#context = context;
    context.logger.info("GitHub plugin initialized.", {
      pluginId: this.manifest.id
    });
  }

  async activate(): Promise<void> {
    this.#context?.logger.info("GitHub plugin activated.", {
      pluginId: this.manifest.id
    });
  }

  async deactivate(): Promise<void> {
    this.#context?.logger.info("GitHub plugin deactivated.", {
      pluginId: this.manifest.id
    });
  }

  async dispose(): Promise<void> {
    this.#context = undefined;
  }
}

export const githubPlugin = new GitHubEngineeringOsPlugin();
export default githubPlugin;
