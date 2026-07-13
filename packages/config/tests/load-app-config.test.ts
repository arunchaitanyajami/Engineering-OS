import { describe, expect, it } from "vitest";

import { loadAppConfig } from "@engineering-os/config";

describe("loadAppConfig", () => {
  it("applies defaults and parses feature flags", () => {
    const config = loadAppConfig({
      EOS_FEATURE_FLAGS: JSON.stringify({ foundationDemo: true }),
      EOS_ENABLE_DEVTOOLS: "false"
    });

    expect(config.appName).toBe("Engineering OS");
    expect(config.featureFlags.foundationDemo).toBe(true);
    expect(config.desktop.enableDevtools).toBe(false);
  });
});
