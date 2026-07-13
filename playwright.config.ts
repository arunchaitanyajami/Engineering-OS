import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/desktop/tests",
  testMatch: /.*\.e2e\.ts/,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry"
  },
  webServer: {
    command: "pnpm --filter @engineering-os/desktop dev:e2e",
    port: 4173,
    reuseExistingServer: true,
    timeout: 30_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
