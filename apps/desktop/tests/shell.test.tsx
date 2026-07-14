import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "../src/App";

describe("desktop shell", () => {
  it("shows the Engineering OS shell screen", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Engineering OS" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Desktop Shell")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Start a new engineering session/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Command Palette" })
    ).toBeInTheDocument();
  });
});
