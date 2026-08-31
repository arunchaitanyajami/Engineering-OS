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

const plugin = {
  manifest,
  async initialize(context) {
    activeContext = context;
    context.logger.info("Example MCP plugin initializing.", {
      pluginId: context.plugin.id,
      mcpServers: manifest.mcp.map((server) => server.id)
    });
  },
  async activate() {
    activeContext?.logger.info(
      "Example MCP plugin activated. MCP servers are started by the gateway."
    );
  },
  async deactivate() {
    activeContext?.logger.info("Example MCP plugin deactivated.");
  },
  async dispose() {
    activeContext?.logger.info("Example MCP plugin disposed.");
    activeContext = null;
  }
};

export default plugin;
