import { describe, expect, it } from "vitest";

import { MockDesktopPlatform } from "@engineering-os/platform";

describe("MockDesktopPlatform", () => {
  it("records opened urls for tests", async () => {
    const platform = new MockDesktopPlatform();

    await platform.openExternalUrl("https://engineering-os.dev");

    expect(platform.openedUrls).toEqual(["https://engineering-os.dev"]);
    await expect(platform.getAppVersion()).resolves.toBe("0.1.0");
  });
});
