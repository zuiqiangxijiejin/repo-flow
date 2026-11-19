import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";
import {
  enableAdvancedInputTools,
  openWorkspaceSettings,
} from "./utils/workspace";

test("optional input tools are off by default and can be enabled without losing the draft", async ({
  page,
}) => {
  mockLangGraphAPI(page);
  await page.goto("/workspace/chats/new");
  const input = page.getByPlaceholder(/how can i assist you/i);
  await input.fill("Keep this repository task draft");
  await expect(page.getByTestId("mention-button")).toHaveCount(0);
  await expect(page.getByTestId("polish-input-button")).toHaveCount(0);
  await enableAdvancedInputTools(page);
  await expect(input).toHaveValue("Keep this repository task draft");
  await expect(page.getByTestId("mention-button")).toBeVisible();
  await expect(page.getByTestId("polish-input-button")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("polish-input-button")).toBeVisible();
});

test("optional task and usage pages open from settings without adding sidebar entries", async ({
  page,
}) => {
  mockLangGraphAPI(page);
  await page.goto("/workspace/chats/new");
  const sidebar = page.locator('[data-sidebar="sidebar"]');
  await expect(
    sidebar.getByRole("link", { name: /Scheduled tasks|Token usage/ }),
  ).toHaveCount(0);
  const dialog = await openWorkspaceSettings(page, "Optional features");
  await dialog
    .getByRole("link", { name: "Scheduled tasks", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/workspace\/scheduled-tasks$/);
  await expect(page.getByTestId("scheduled-task-new")).toBeVisible();
});
