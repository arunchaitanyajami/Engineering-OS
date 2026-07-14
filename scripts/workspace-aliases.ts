import { fileURLToPath } from "node:url";

const workspaceAliasEntries = [
  ["@engineering-os/shared", "../packages/shared/src/index.ts"],
  ["@engineering-os/contracts", "../packages/contracts/src/index.ts"],
  ["@engineering-os/core", "../packages/core/src/index.ts"],
  ["@engineering-os/config", "../packages/config/src/index.ts"],
  ["@engineering-os/logger", "../packages/logger/src/index.ts"],
  ["@engineering-os/database", "../packages/database/src/index.ts"],
  ["@engineering-os/platform", "../packages/platform/src/index.ts"],
  ["@engineering-os/security", "../packages/security/src/index.ts"],
  ["@engineering-os/events", "../packages/events/src/index.ts"],
  ["@engineering-os/ui", "../packages/ui/src/index.tsx"],
  ["@engineering-os/testing", "../packages/testing/src/index.ts"]
] as const;

export const workspaceAliases = Object.fromEntries(
  workspaceAliasEntries.map(([packageName, relativePath]) => [
    packageName,
    fileURLToPath(new URL(relativePath, import.meta.url))
  ])
);
