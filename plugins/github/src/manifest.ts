import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pluginManifestSchema } from "@engineering-os/contracts";

const manifestFileName = "engineering-os.plugin.json";

const resolveManifestPath = () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", manifestFileName),
    join(here, "..", manifestFileName),
    join(here, manifestFileName)
  ];

  for (const candidate of candidates) {
    try {
      return { path: candidate, contents: readFileSync(candidate, "utf8") };
    } catch {
      continue;
    }
  }

  throw new Error(
    `GitHub plugin manifest '${manifestFileName}' was not found.`
  );
};

export const githubPluginManifest = pluginManifestSchema.parse(
  JSON.parse(resolveManifestPath().contents)
);
