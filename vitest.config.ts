import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@engineering-os/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url)
      ),
      "@engineering-os/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url)
      ),
      "@engineering-os/config": fileURLToPath(
        new URL("./packages/config/src/index.ts", import.meta.url)
      ),
      "@engineering-os/logger": fileURLToPath(
        new URL("./packages/logger/src/index.ts", import.meta.url)
      ),
      "@engineering-os/database": fileURLToPath(
        new URL("./packages/database/src/index.ts", import.meta.url)
      ),
      "@engineering-os/platform": fileURLToPath(
        new URL("./packages/platform/src/index.ts", import.meta.url)
      ),
      "@engineering-os/security": fileURLToPath(
        new URL("./packages/security/src/index.ts", import.meta.url)
      ),
      "@engineering-os/events": fileURLToPath(
        new URL("./packages/events/src/index.ts", import.meta.url)
      ),
      "@engineering-os/ui": fileURLToPath(
        new URL("./packages/ui/src/index.tsx", import.meta.url)
      ),
      "@engineering-os/testing": fileURLToPath(
        new URL("./packages/testing/src/index.ts", import.meta.url)
      )
    }
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
