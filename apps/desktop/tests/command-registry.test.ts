import { describe, expect, it, vi } from "vitest";

import {
  ApplicationCommandRegistry,
  shouldHandleGlobalShortcut
} from "../src/services/command-registry";

describe("ApplicationCommandRegistry", () => {
  it("filters commands by query", () => {
    const registry = new ApplicationCommandRegistry();
    const execute = vi.fn();

    registry.register({
      id: "settings",
      title: "Open Settings",
      category: "Navigation",
      keywords: ["preferences"],
      execute
    });

    expect(registry.list("pref")).toHaveLength(1);
  });

  it("executes commands by id", async () => {
    const registry = new ApplicationCommandRegistry();
    const execute = vi.fn();

    registry.register({
      id: "reload",
      title: "Reload Application",
      category: "Application",
      keywords: ["reload"],
      execute
    });

    await registry.execute("reload");

    expect(execute).toHaveBeenCalledOnce();
  });

  it("ignores global shortcuts inside form fields", () => {
    const input = document.createElement("input");

    expect(shouldHandleGlobalShortcut(input)).toBe(false);
    expect(shouldHandleGlobalShortcut(document.body)).toBe(true);
  });
});
