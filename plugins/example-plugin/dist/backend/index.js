import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const readManifest = () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  return JSON.parse(
    readFileSync(join(packageRoot, "engineering-os.plugin.json"), "utf8")
  );
};

const manifest = readManifest();

/** @type {import("@engineering-os/contracts/unstable-runtime").EngineeringOsPluginContext | null} */
let activeContext = null;

/** @type {boolean} */
let simulateFailure = false;

const readOptionalConfiguration = async (context, key) => {
  try {
    return await context.configuration.get(key);
  } catch (error) {
    context.logger.debug("Configuration broker unavailable; skipping key read.", {
      key,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
};

const plugin = {
  manifest,
  async initialize(context) {
    activeContext = context;
    context.logger.info("Example plugin initializing.", {
      pluginId: context.plugin.id,
      version: context.plugin.version
    });

    const greeting = await readOptionalConfiguration(context, "greeting");
    if (typeof greeting === "string" && greeting.length > 0) {
      context.logger.debug("Loaded plugin configuration.", { greeting });
    }

    const failureFlag = await readOptionalConfiguration(context, "simulateFailure");
    simulateFailure = failureFlag === true || failureFlag === "true";

    const canUseSecrets = await context.permissions.has("secrets.read");

    if (!canUseSecrets) {
      context.logger.warn(
        "Secrets permission is not granted yet. Skipping namespaced state restore."
      );
      return;
    }

    try {
      const existingState = await context.secrets.get("example-state");

      if (existingState) {
        context.logger.info("Restored namespaced plugin state.", {
          state: JSON.parse(existingState)
        });
        return;
      }

      await context.secrets.set(
        "example-state",
        JSON.stringify({
          initializedAt: new Date().toISOString(),
          source: "example-plugin"
        })
      );
      context.logger.info("Created namespaced plugin state.");
    } catch (error) {
      context.logger.error(
        "Failed to initialize namespaced plugin state.",
        error
      );
      throw error;
    }
  },
  async activate() {
    if (!activeContext) {
      throw new Error("Example plugin activate() called before initialize().");
    }

    if (simulateFailure) {
      const error = new Error(
        "Simulated activation failure for reference documentation."
      );
      activeContext.logger.error("Example plugin activation failed.", error);
      throw error;
    }

    activeContext.logger.info("Example plugin activated.");
  },
  async deactivate() {
    activeContext?.logger.info("Example plugin deactivated.");
  },
  async dispose() {
    activeContext?.logger.info("Example plugin disposed.");
    activeContext = null;
    simulateFailure = false;
  }
};

export default plugin;
