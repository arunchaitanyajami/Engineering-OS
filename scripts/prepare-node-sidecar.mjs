import { chmod, copyFile, mkdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetTriple = execFileSync("rustc", ["--print", "host-tuple"], {
  encoding: "utf8"
}).trim();
const sidecarDirectory = resolve(
  rootDirectory,
  "apps/desktop/src-tauri/binaries"
);
const sidecarExtension = process.platform === "win32" ? ".exe" : "";
const sidecarPath = resolve(
  sidecarDirectory,
  `engineering-os-node-${targetTriple}${sidecarExtension}`
);

await mkdir(sidecarDirectory, { recursive: true });
await copyFile(process.execPath, sidecarPath);

if (extname(sidecarPath) !== ".exe") {
  await chmod(sidecarPath, 0o755);
}
