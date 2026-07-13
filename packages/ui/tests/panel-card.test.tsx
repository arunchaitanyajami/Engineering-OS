import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PanelCard } from "@engineering-os/ui";

describe("PanelCard", () => {
  it("renders reusable panel content", () => {
    render(
      <PanelCard eyebrow="Workspace" title="Foundation">
        <p>Milestone 0</p>
      </PanelCard>
    );

    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Foundation" })
    ).toBeInTheDocument();
    expect(screen.getByText("Milestone 0")).toBeInTheDocument();
  });
});
