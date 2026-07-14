import { defineConfig } from "vitest/config";

import { workspaceAliases } from "./scripts/workspace-aliases";

export default defineConfig({
  resolve: {
    alias: workspaceAliases
  },
  test: {
    include: [
      "packages/*/tests/**/*.test.ts",
      "packages/*/tests/**/*.test.tsx",
      "packages/*/tests/**/*.integration.test.ts",
      "apps/desktop-backend/tests/**/*.integration.test.ts",
      "apps/desktop/tests/**/*.test.ts",
      "apps/desktop/tests/**/*.test.tsx"
    ],
    environment: "node",
    environmentMatchGlobs: [
      ["packages/ui/tests/**/*.test.tsx", "jsdom"],
      ["apps/desktop/tests/**/*.test.ts", "jsdom"],
      ["apps/desktop/tests/**/*.test.tsx", "jsdom"]
    ]
  }
});
