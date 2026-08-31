import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(pluginRoot, "../..");
const distBackendDirectory = join(pluginRoot, "dist/backend");
const distMcpDirectory = join(pluginRoot, "dist/mcp");

const require = createRequire(import.meta.url);

const loadEsbuild = async () => {
  try {
    return await import("esbuild");
  } catch {
    try {
      return require("esbuild");
    } catch {
      throw new Error(
        "GitHub plugin build needs esbuild. From the Engineering OS repo root run `pnpm install`, then run `npm run build` in plugins/github. Do not add node_modules inside this plugin package — the desktop registry rejects those symbolic links."
      );
    }
  }
};

const resolveMonorepoPackage = (relativePath) => {
  const absolutePath = resolve(repoRoot, relativePath);
  return absolutePath;
};

await mkdir(distBackendDirectory, { recursive: true });
await mkdir(distMcpDirectory, { recursive: true });

await copyFile(
  join(pluginRoot, "runtime/backend.js"),
  join(distBackendDirectory, "index.js")
);

const { build } = await loadEsbuild();

await build({
  absWorkingDir: pluginRoot,
  entryPoints: [join(pluginRoot, "src/mcp/server.ts")],
  outfile: join(distMcpDirectory, "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  alias: {
    "@engineering-os/contracts/unstable-runtime": resolveMonorepoPackage(
      "packages/contracts/src/unstable-runtime.ts"
    ),
    "@engineering-os/contracts": resolveMonorepoPackage(
      "packages/contracts/src/index.ts"
    ),
    "@engineering-os/plugin-sdk": resolveMonorepoPackage(
      "packages/plugin-sdk/src/index.ts"
    ),
    "@engineering-os/source-control-domain": resolveMonorepoPackage(
      "packages/source-control-domain/src/index.ts"
    )
  }
});

process.stdout.write(
  "Wrote plugins/github/dist/backend/index.js and plugins/github/dist/mcp/server.js\n"
);
