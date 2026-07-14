import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = resolve(
  rootDirectory,
  "apps/desktop-backend/dist/server.js"
);

await mkdir(dirname(outputFile), { recursive: true });

await build({
  entryPoints: [resolve(rootDirectory, "apps/desktop-backend/src/server.ts")],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  tsconfig: resolve(rootDirectory, "apps/desktop-backend/tsconfig.json")
});
