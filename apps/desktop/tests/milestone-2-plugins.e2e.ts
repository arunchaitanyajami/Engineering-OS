import { join } from "node:path";

import { expect, test } from "@playwright/test";

const exampleMcpPluginPath = join(
  process.cwd(),
  "plugins/example-mcp-plugin"
);
const exampleMcpPluginId = "com.engineering-os.example-mcp";
const exampleMcpRegistrationId = `${exampleMcpPluginId}:example`;

test.describe("Milestone 2 plugin management", () => {
  test("registers the bundled example MCP plugin and exercises the gateway", async ({
    page
  }) => {
    test.setTimeout(90_000);

    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "Desktop preferences" })
    ).toBeVisible();
    await page.getByRole("link", { name: "Manage plugins" }).click();

    await expect(
      page.getByRole("heading", { name: "Plugins", exact: true })
    ).toBeVisible();

    await page
      .getByPlaceholder("/absolute/path/to/plugin-package")
      .fill(exampleMcpPluginPath);
    await page.getByRole("button", { name: "Register local package" }).click();

    await expect(page.getByText("Example MCP Plugin")).toBeVisible();
    await page.getByRole("link", { name: "Example MCP Plugin" }).click();
    await expect(
      page.getByRole("heading", { name: "Example MCP Plugin" })
    ).toBeVisible();

    await page.locator(".tab-row").getByRole("button", { name: "Permissions" }).click();
    await expect(page.getByText("Pending requirements")).toBeVisible();
    await page.getByRole("button", { name: "Grant pending permissions" }).click();
    await expect(
      page.getByRole("button", { name: "Enable" })
    ).toBeEnabled();

    await page.getByRole("button", { name: "Enable" }).click();
    await expect(page.getByRole("button", { name: "Disable" })).toBeVisible({
      timeout: 15_000
    });

    await page.locator(".tab-row").getByRole("button", { name: "Overview" }).click();
    await page.getByRole("button", { name: "Health" }).click();
    await expect(page.locator(".code-block")).toContainText('"healthy": true', {
      timeout: 15_000
    });

    await page.getByRole("button", { name: "MCP Servers" }).click();
    await expect(
      page.getByRole("heading", { name: "MCP Servers", exact: true })
    ).toBeVisible();
    await page.getByRole("link", { name: /Example MCP Server/i }).click();

    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("button", { name: "Tools" }).click();
    await expect(page.getByText("echo")).toBeVisible();
    await expect(page.getByText("get_current_workspace_info")).toBeVisible();

    await page.getByRole("link", { name: "Open tool console" }).click();
    await expect(
      page.getByRole("heading", { name: "MCP Tool Test Console" })
    ).toBeVisible();
    await page.getByLabel("Discovered tool").selectOption({ label: /\/echo$/ });
    await page
      .getByLabel("Arguments (JSON)")
      .fill(JSON.stringify({ message: "hello from milestone 2 e2e" }));
    await page.getByRole("button", { name: "Execute tool" }).click();
    await expect(page.locator(".code-block")).toContainText(
      "hello from milestone 2 e2e",
      { timeout: 15_000 }
    );

    await page.getByRole("button", { name: "Plugins" }).click();
    await page.getByRole("link", { name: "Example MCP Plugin" }).click();
    await page.getByRole("button", { name: "Disable" }).click();
    await expect(page.getByRole("button", { name: "Enable" })).toBeVisible({
      timeout: 15_000
    });

    await page.goto("/mcp/tool-console");
    await expect(page.getByText("No tools available")).toBeVisible();

    await page.getByRole("button", { name: "MCP Servers" }).click();
    await expect(page.getByText(exampleMcpRegistrationId)).toBeVisible();
  });
});
