import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("navigates without full reload and shows placeholder routes", async ({
  page
}) => {
  await expect(
    page.getByRole("heading", { name: "Engineering OS" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Plugins" }).click();

  await expect(
    page.getByRole("heading", { name: "Plugins", exact: true })
  ).toBeVisible();
  await expect(page.getByText(/not available yet/i)).toBeVisible();
});

test("creates and reopens a local session shell", async ({ page }) => {
  await page.getByRole("button", { name: "New Session" }).first().click();

  await expect(page.getByRole("heading", { name: /Session 1/i })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Sessions" }).click();

  await expect(page.getByText(/Session 1/i)).toBeVisible();
});

test("persists theme preference after reload", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Theme preference").selectOption("dark");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("opens the command palette", async ({ page }) => {
  await page.locator("body").click();
  await page
    .locator("body")
    .press(`${process.platform === "darwin" ? "Meta" : "Control"}+K`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Command Palette")
  ).toBeVisible();
});
