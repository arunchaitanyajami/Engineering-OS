import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette } from "../src/components/command-palette";
import { ApplicationCommandRegistry } from "../src/services/command-registry";

describe("CommandPalette", () => {
  it("renders commands and executes the selected entry", () => {
    const registry = new ApplicationCommandRegistry();
    const execute = vi.fn();

    registry.register({
      id: "settings",
      title: "Open Settings",
      category: "Navigation",
      keywords: ["preferences"],
      execute
    });

    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        registry={registry}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));

    expect(execute).toHaveBeenCalledOnce();
  });
});
