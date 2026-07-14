import { defineConfig } from "vitest/config";

import { workspaceAliases } from "./scripts/workspace-aliases";

export default defineConfig({
  resolve: {
    alias: workspaceAliases
  },
  test: {
    include: [
      "packages/*/tests/**/*.integration.test.ts",
      "apps/desktop-backend/tests/**/*.integration.test.ts"
    ],
    environment: "node"
  }
});
