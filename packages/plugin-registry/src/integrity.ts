import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { PluginRegistryError } from "./service.js";

export const calculateManagedInstallationHash = async (
  rootPath: string
): Promise<string> => {
  const entries: string[] = [];

  const collectFiles = async (currentPath: string) => {
    const currentStats = await lstat(currentPath);

    if (currentStats.isDirectory()) {
      const children = await readdir(currentPath);

      for (const child of children.sort((left, right) =>
        left.localeCompare(right)
      )) {
        await collectFiles(join(currentPath, child));
      }

      return;
    }

    if (currentStats.isSymbolicLink()) {
      throw new PluginRegistryError(
        "PLUGIN_SYMLINK_UNSUPPORTED",
        `Plugin package path '${currentPath}' contains an unsupported symbolic link.`,
        400
      );
    }

    entries.push(currentPath);
  };

  await collectFiles(rootPath);

  const hash = createHash("sha256");

  for (const entry of entries) {
    hash.update(relative(rootPath, entry));
    hash.update("\n");
    hash.update(await readFile(entry));
    hash.update("\n");
  }

  return hash.digest("hex");
};
