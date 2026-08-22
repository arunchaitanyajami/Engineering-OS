import type { PluginManifest } from "@engineering-os/contracts";
import type {
  McpServerHealthSnapshot,
  PluginRuntimeHealthSnapshot
} from "@engineering-os/contracts/unstable-runtime";
import { McpGatewayError, McpGatewayService } from "@engineering-os/mcp-gateway";
import { PermissionEngineService } from "@engineering-os/permission-engine";
import type { InstalledPlugin } from "@engineering-os/plugin-registry";
import {
  PluginRegistryError,
  PluginRegistryService
} from "@engineering-os/plugin-registry";
import { PluginRuntimeService } from "@engineering-os/plugin-runtime";

export interface PluginLifecycleServiceOptions {
  readonly pluginRegistry: PluginRegistryService;
  readonly pluginRuntime: PluginRuntimeService;
  readonly mcpGateway: McpGatewayService;
  readonly permissionEngine: PermissionEngineService;
}

export interface PluginEnableOptions {
  readonly sessionId?: string;
}

export class PluginLifecycleService {
  private readonly lifecycleLocks = new Map<string, Promise<void>>();

  constructor(private readonly options: PluginLifecycleServiceOptions) {}

  enablePlugin(
    pluginId: string,
    options: PluginEnableOptions = {}
  ): Promise<InstalledPlugin> {
    return this.runWithLifecycleLock(pluginId, async () => {
      this.options.permissionEngine.assertCanEnablePlugin(
        pluginId,
        options.sessionId
      );
      return this.options.pluginRegistry.enableInstalledPlugin(pluginId);
    });
  }

  disablePlugin(pluginId: string): Promise<InstalledPlugin> {
    return this.runWithLifecycleLock(pluginId, async () => {
      await this.options.mcpGateway.stopServersForPlugin(pluginId);
      await this.options.pluginRuntime.stopPlugin(pluginId);
      return this.options.pluginRegistry.disableInstalledPlugin(pluginId);
    });
  }

  async upgradePlugin(
    packagePath: string
  ): Promise<{
    readonly plugin: InstalledPlugin;
    readonly previousManifest: PluginManifest;
    readonly revokedScopes: readonly string[];
  }> {
    const inspectedPackage =
      await this.options.pluginRegistry.inspectLocalPluginPackage(packagePath);

    return this.runWithLifecycleLock(
      inspectedPackage.manifest.id,
      async () => {
        const wasEnabled = Boolean(
          this.options.pluginRegistry.getInstalledPlugin(
            inspectedPackage.manifest.id
          )?.enabled
        );

        if (wasEnabled) {
          await this.options.mcpGateway.stopServersForPlugin(
            inspectedPackage.manifest.id
          );
          await this.options.pluginRuntime.stopPlugin(inspectedPackage.manifest.id);
        }

        const upgradeResult =
          await this.options.pluginRegistry.upgradeLocalPluginPackage(
            packagePath
          );
        const revokedScopes =
          this.options.permissionEngine.syncGrantsAfterUpgrade(
            upgradeResult.plugin.pluginId,
            upgradeResult.previousManifest
          );
        const review = this.options.permissionEngine.getPermissionReview(
          upgradeResult.plugin.pluginId
        );

        if (wasEnabled && !review.canEnable) {
          await this.options.pluginRegistry.disableInstalledPlugin(
            upgradeResult.plugin.pluginId
          );
        }

        return {
          plugin: this.options.pluginRegistry.getInstalledPlugin(
            upgradeResult.plugin.pluginId
          ) ?? upgradeResult.plugin,
          previousManifest: upgradeResult.previousManifest,
          revokedScopes
        };
      }
    );
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

  startPluginMcpServer(
    pluginId: string,
    registrationId: string
  ): Promise<McpServerHealthSnapshot> {
    return this.runWithLifecycleLock(pluginId, async () => {
      this.requireEnabledPlugin(pluginId);
      this.requirePluginOwnedRegistration(pluginId, registrationId);
      return this.options.mcpGateway.startServer(registrationId);
    });
  }

  stopPluginMcpServer(
    pluginId: string,
    registrationId: string
  ): Promise<McpServerHealthSnapshot> {
    return this.runWithLifecycleLock(pluginId, async () => {
      this.requirePluginOwnedRegistration(pluginId, registrationId);
      return this.options.mcpGateway.stopServer(registrationId);
    });
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

  private requireEnabledPlugin(pluginId: string): InstalledPlugin {
    const plugin = this.options.pluginRegistry.getInstalledPlugin(pluginId);

    if (!plugin) {
      throw new PluginRegistryError(
        "PLUGIN_NOT_FOUND",
        `Plugin '${pluginId}' is not registered.`,
        404
      );
    }

    if (!plugin.enabled) {
      throw new PluginRegistryError(
        "PLUGIN_DISABLED",
        `Plugin '${pluginId}' is disabled.`,
        409
      );
    }

    return plugin;
  }

  private requirePluginOwnedRegistration(
    pluginId: string,
    registrationId: string
  ): void {
    const server = this.options.mcpGateway.inspectServerHealth(registrationId);

    if (
      server.source.type !== "plugin" ||
      server.source.pluginId !== pluginId
    ) {
      throw new McpGatewayError(
        "MCP_GATEWAY_PLUGIN_OWNERSHIP_MISMATCH",
        `MCP server '${registrationId}' is not owned by plugin '${pluginId}'.`,
        409
      );
    }
  }
}
