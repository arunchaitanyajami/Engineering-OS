import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "../src/App";

describe("desktop shell", () => {
  it("shows the Engineering OS shell screen", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "Desktop Shell" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Milestone 0 now validates the monorepo/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Chat input" })
    ).toBeInTheDocument();
  });
});
