import type { PluginRuntimeHealthSnapshot } from "@engineering-os/contracts/unstable-runtime";
import type { InstalledPlugin } from "@engineering-os/plugin-registry";
import { PluginRegistryService } from "@engineering-os/plugin-registry";
import { PluginRuntimeService } from "@engineering-os/plugin-runtime";

export interface PluginLifecycleServiceOptions {
  readonly pluginRegistry: PluginRegistryService;
  readonly pluginRuntime: PluginRuntimeService;
}

export class PluginLifecycleService {
  private readonly lifecycleLocks = new Map<string, Promise<void>>();

  constructor(private readonly options: PluginLifecycleServiceOptions) {}

  enablePlugin(pluginId: string): Promise<InstalledPlugin> {
    return this.runWithLifecycleLock(pluginId, async () =>
      this.options.pluginRegistry.enableInstalledPlugin(pluginId)
    );
  }

  async disablePlugin(pluginId: string): Promise<InstalledPlugin> {
    return this.runWithLifecycleLock(pluginId, async () => {
      await this.options.pluginRuntime.stopPlugin(pluginId);
      return this.options.pluginRegistry.disableInstalledPlugin(pluginId);
    });
  }

  startPlugin(pluginId: string): Promise<PluginRuntimeHealthSnapshot> {
    return this.runWithLifecycleLock(pluginId, async () =>
      this.options.pluginRuntime.startPlugin(pluginId)
    );
  }

  stopPlugin(pluginId: string): Promise<PluginRuntimeHealthSnapshot> {
    return this.runWithLifecycleLock(pluginId, async () =>
      this.options.pluginRuntime.stopPlugin(pluginId)
    );
  }

  private async runWithLifecycleLock<T>(
    pluginId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const activeLock = this.lifecycleLocks.get(pluginId) ?? Promise.resolve();
    let releaseLock: () => void = () => undefined;
    const queuedLock = activeLock.then(
      () =>
        new Promise<void>((resolve) => {
          releaseLock = resolve;
        })
    );

    this.lifecycleLocks.set(pluginId, queuedLock);
    await activeLock;

    try {
      return await operation();
    } finally {
      releaseLock();

      if (this.lifecycleLocks.get(pluginId) === queuedLock) {
        this.lifecycleLocks.delete(pluginId);
      }
    }
  }
}
