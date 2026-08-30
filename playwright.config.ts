import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/desktop/tests",
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry"
  },
  webServer: {
    command: "node ./scripts/start-e2e-desktop-env.mjs",
    port: 4173,
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
