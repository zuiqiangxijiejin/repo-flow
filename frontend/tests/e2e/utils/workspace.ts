import { expect, type Page } from "@playwright/test";

export async function openWorkspaceSettings(page: Page, section?: string) {
  const trigger = page
    .getByRole("button", { name: /toggle sidebar|切换侧边栏/i })
    .first();
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    // SSR initially renders the desktop sidebar. Wait for the responsive
    // presentation before deciding whether the mobile drawer must be opened.
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  }
  const button = page
    .getByRole("button", { name: /^(Settings|设置)$/ })
    .first();
  if (!(await button.isVisible())) {
    await trigger.click();
  }
  await button.click();
  const dialog = page.getByRole("dialog", { name: /^(Settings|设置)$/ });
  if (section)
    await dialog.getByRole("button", { name: section, exact: true }).click();
  return dialog;
}

export async function enableAdvancedInputTools(page: Page) {
  const dialog = await openWorkspaceSettings(page, "Appearance");
  await dialog
    .getByRole("switch", { name: "Advanced input tools", exact: true })
    .check();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}
