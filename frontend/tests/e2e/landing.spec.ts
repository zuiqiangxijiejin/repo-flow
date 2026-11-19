import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

test.describe("Application entry", () => {
  test("opens the RepoFlow workspace directly", async ({ page }) => {
    mockLangGraphAPI(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/workspace\/chats\/new$/);
    await expect(
      page.getByRole("link", { name: "New chat", exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(/how can i assist you/i)).toBeVisible();
  });

  for (const width of [320, 375, 390]) {
    test(`does not overflow at ${width}px width`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      mockLangGraphAPI(page);
      await page.goto("/");

      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      await expect(page.locator("main").first()).toBeInViewport();
    });
  }

  test("new chat stays available without a marketing page", async ({
    page,
  }) => {
    mockLangGraphAPI(page);

    await page.goto("/");

    await page.getByRole("link", { name: "New chat", exact: true }).click();
    await page.waitForURL("**/workspace/chats/new");
    await expect(page).toHaveURL(/\/workspace\/chats\/new/);
  });
});
