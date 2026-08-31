import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickPluginDirectory } from "../src/services/plugin-directory-picker.js";

const openMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args)
}));

vi.mock("../src/services/desktop-backend-request.js", () => ({
  isTauriEnvironment: () => true
}));

describe("pickPluginDirectory", () => {
  beforeEach(() => {
    openMock.mockReset();
  });

  it("returns the selected directory path", async () => {
    openMock.mockResolvedValue("/Users/dev/plugins/example-plugin");

    await expect(pickPluginDirectory()).resolves.toBe(
      "/Users/dev/plugins/example-plugin"
    );
    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Select plugin package directory"
    });
  });

  it("returns null when the dialog is cancelled", async () => {
    openMock.mockResolvedValue(null);

    await expect(pickPluginDirectory()).resolves.toBeNull();
  });
});
