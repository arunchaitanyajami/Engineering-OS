import { test, expect } from "@playwright/test";

test("renders the desktop shell foundation screen", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Desktop Shell", exact: true })
  ).toBeVisible();
  await expect(page.getByText("AI-native engineering platform")).toBeVisible();
  await expect(page.getByPlaceholder("Example: Review PR 123")).toBeVisible();
});
