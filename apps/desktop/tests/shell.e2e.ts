import { test, expect } from "@playwright/test";

test("renders the desktop shell foundation screen", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Desktop Shell", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Engineering OS" })
  ).toBeVisible();
  await expect(
    page.getByText(/Start a new engineering session/i)
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Command Palette" })
  ).toBeVisible();
});
