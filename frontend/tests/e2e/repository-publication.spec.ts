import { readFileSync } from "node:fs";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { mockLangGraphAPI, MOCK_THREAD_ID } from "./utils/mock-api";

for (const width of [1366, 1440, 1920])
  test(`repository workspace keeps full labels and a usable icon rail at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({
      width,
      height: width === 1366 ? 768 : width === 1440 ? 900 : 1080,
    });
    await page.addInitScript(() => {
      document.cookie = "locale=zh-CN; path=/; SameSite=Lax";
    });
    const { activity } = await mockPublication(page, false, {
      repository:
        "alice/contribution-with-a-complete-repository-name → upstream/repo",
      fork: "alice/contribution-with-a-complete-repository-name",
      published_commit: "a".repeat(40),
      commit_author: { name: "alice", email: "alice@example.test" },
      pull_request: {
        number: 42,
        repository: "upstream/repo",
        state: "open",
        draft: true,
        url: "https://github.com/upstream/repo/pull/42",
      },
    });
    const modelName =
      "Long provider / A complete model display name that wraps instead of disappearing";
    await page.route("**/api/models", (route) =>
      route.fulfill({
        json: {
          models: [
            {
              name: "layout-model",
              display_name: modelName,
              supports_thinking: true,
              supports_reasoning_effort: true,
            },
          ],
        },
      }),
    );
    await page.route("**/api/v1/auth/preferences", (route) =>
      route.fulfill({
        json: {
          model_name: "layout-model",
          mode: "reasoning",
          locale: "zh-CN",
        },
      }),
    );
    await page.goto(`/workspace/chats/${MOCK_THREAD_ID}`);
    const header = page.locator(".repoflow-chat-header");
    const toolbar = page.getByRole("region", {
      name: "GitHub repository",
      exact: true,
    });
    await expect(toolbar).toContainText(
      "alice/contribution-with-a-complete-repository-name → upstream/repo",
    );
    const model = page.getByRole("button", { name: modelName, exact: true });
    await expect(model).toBeVisible();
    expect(
      await model.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    expect(
      await header.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    await page.getByRole("button", { name: "查看改动", exact: true }).click();
    const panel = page.getByRole("region", { name: "Git review", exact: true });
    await expect(
      panel.getByRole("list", { name: "Git 工作流", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText("草稿 PR 已创建", { exact: true }),
    ).toBeVisible();
    expect((await header.boundingBox())!.height).toBeLessThan(180);
    await panel.getByRole("button", { name: "发布 / PR", exact: true }).click();
    await expect(
      panel.getByText("Fork 推送成功", { exact: true }),
    ).toBeVisible();
    const create = panel.getByRole("button", {
      name: "创建 GitHub 正式 PR",
      exact: true,
    });
    await expect(create).toBeDisabled();
    for (const control of await panel
      .locator(".repo-publication-action button")
      .all()) {
      expect(
        await control.evaluate(
          (node) => node.scrollWidth <= node.clientWidth + 1,
        ),
      ).toBe(true);
      expect(await control.innerText()).not.toMatch(/…|\.\.\./);
    }
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${width}.png`),
    });
    await page
      .getByRole("button", { name: "Toggle Sidebar", exact: true })
      .first()
      .click();
    const rail = page
      .locator('[data-state="collapsed"][data-collapsible="icon"]')
      .first();
    await expect(rail).toBeVisible();
    for (const control of await rail
      .locator('[data-sidebar="menu-button"]')
      .all()) {
      await expect
        .poll(async () => (await control.boundingBox())!.width)
        .toBe(44);
      const bounds = (await control.boundingBox())!;
      expect(bounds.width).toBe(44);
      expect(bounds.height).toBe(44);
      await expect(control).toHaveCSS("border-radius", "12px");
    }
    await expect
      .poll(
        async () =>
          (await page
            .locator('[data-slot="sidebar-container"]')
            .first()
            .boundingBox())!.width,
      )
      .toBe(64);
    await expect
      .poll(async () => (await header.boundingBox())!.height)
      .toBeLessThan(180);
    await expect(
      page.getByRole("button", { name: "GitHub 仓库", exact: true }),
    ).toBeVisible();
    for (const [buttonName, dialogName] of [
      ["SSH 连接", "SSH 主机配置"],
      ["仓库配置", "仓库配置"],
      ["克隆管理", "克隆管理"],
    ]) {
      const shortcut = page.getByRole("button", {
        name: buttonName,
        exact: true,
      });
      await expect(shortcut).toBeVisible();
      const shortcutBox = (await shortcut.boundingBox())!;
      expect(shortcutBox.width).toBe(44);
      expect(shortcutBox.height).toBe(44);
      await expect(shortcut).toHaveCSS("border-radius", "12px");
      expect((await shortcut.getAttribute("title"))!.length).toBeGreaterThan(4);
      await shortcut.click();
      const dialog = page.getByRole("dialog", {
        name: dialogName,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(rail).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath(`workspace-icon-rail-${width}.png`),
    });
    await page
      .getByRole("button", { name: "GitHub 仓库", exact: true })
      .click();
    await expect(page.locator(".repoflow-wordmark")).toBeVisible();
    await panel
      .getByRole("button", { name: "收起 Git 审阅", exact: true })
      .click();
    await expect(panel).not.toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    expect(activity()).toEqual({ pushes: 0, prs: 0 });
  });

for (const scenario of [
  { locale: "zh-CN", theme: "light", width: 1440, height: 1000 },
  { locale: "zh-CN", theme: "dark", width: 360, height: 640 },
  { locale: "en-US", theme: "light", width: 420, height: 480 },
  { locale: "en-US", theme: "dark", width: 900, height: 900 },
])
  test(`PR confirmation aligns controls and wraps long details in ${scenario.locale} ${scenario.theme} ${scenario.width}px`, async ({
    page,
  }, testInfo) => {
    const zh = scenario.locale === "zh-CN";
    const t = (cn: string, en: string) => (zh ? cn : en);
    await page.setViewportSize({
      width: scenario.width,
      height: scenario.height,
    });
    await page.addInitScript(({ locale, theme }) => {
      document.cookie = `locale=${locale}; path=/; SameSite=Lax`;
      localStorage.setItem("theme", theme);
    }, scenario);
    const target = "upstream/" + "long-repository-name-".repeat(4);
    const base = "release/" + "long-target-branch-".repeat(6);
    const title =
      "Add solutions for the Parsing a local tzname exercise with documentation and executable examples";
    const { activity } = await mockPublication(page, false, {
      target,
      upstream_target: target,
      base_branch: base,
      title,
      published_commit: "a".repeat(40),
    });
    await page.goto(`/workspace/chats/${MOCK_THREAD_ID}`);
    await page
      .getByRole("button", { name: t("查看改动", "View changes"), exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Git review",
      exact: true,
    });
    await panel
      .getByRole("button", {
        name: t("发布 / PR", "Publish / PR"),
        exact: true,
      })
      .click();
    for (const draft of [true, false]) {
      await panel
        .getByRole("button", {
          name: draft
            ? t("创建 GitHub 草稿 PR", "Create draft PR")
            : t("创建 GitHub 正式 PR", "Create PR"),
          exact: true,
        })
        .click();
      const dialog = panel.getByRole("dialog", {
        name: t("确认提交到 GitHub", "Confirm GitHub submission"),
        exact: true,
      });
      const checkbox = dialog.getByRole("checkbox");
      const final = dialog.getByRole("button", {
        name: draft
          ? t("确认创建草稿 PR", "Confirm draft PR")
          : t("确认创建正式 PR", "Confirm PR"),
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(final).toBeDisabled();
      await dialog.screenshot({
        path: testInfo.outputPath(
          `confirmation-${draft ? "draft" : "regular"}.png`,
        ),
      });
      const box = await checkbox.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(16);
      expect(box!.width).toBeLessThanOrEqual(24);
      expect(box!.height).toBeLessThanOrEqual(24);
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(8);
      expect(bounds!.y).toBeGreaterThanOrEqual(8);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(scenario.width - 8);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
        scenario.height - 8,
      );
      expect(
        await dialog.evaluate(
          (node) => node.scrollWidth <= node.clientWidth + 1,
        ),
      ).toBe(true);
      const label = checkbox.locator("..");
      const text = await label.locator("span").boundingBox();
      expect(text!.x - (box!.x + box!.width)).toBeGreaterThanOrEqual(6);
      expect(text!.width).toBeGreaterThan(150);
      const cancel = dialog.getByRole("button", {
        name: t("取消", "Cancel"),
        exact: true,
      });
      await expect(final).toBeInViewport({ ratio: 1 });
      const finalBox = await final.boundingBox();
      const cancelBox = await cancel.boundingBox();
      expect(Math.abs(finalBox!.y - cancelBox!.y)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(finalBox!.height - cancelBox!.height),
      ).toBeLessThanOrEqual(1);
      await checkbox.check();
      await expect(final).toBeEnabled();
      if (draft) await page.keyboard.press("Escape");
      else await cancel.click();
      await expect(dialog).not.toBeVisible();
      expect(activity().prs).toBe(0);
    }
  });

async function mockPublication(
  page: Page,
  queued = false,
  overrides: Record<string, unknown> = {},
) {
  mockLangGraphAPI(page, { threads: [{ thread_id: MOCK_THREAD_ID }] });
  const assets = `/api/plugins/repoflow.repositories/assets/${"a".repeat(64)}/static/`;
  const directory = path.resolve(
    process.cwd(),
    "../examples/deerflow-extension-repository-tasks/repoflow_repository_tasks/static",
  );
  let data: Record<string, unknown> = {
    thread: MOCK_THREAD_ID,
    repository: "alice/fork → upstream/repo",
    fork: "alice/fork",
    target: "upstream/repo",
    upstream_target: "upstream/repo",
    base: "b".repeat(40),
    base_branch: "master",
    branch: `repoflow/${MOCK_THREAD_ID}`,
    commit: "a".repeat(40),
    publication_revision: "revision",
    title: "Reviewed fix",
    pr_body: "Actual description. ".repeat(90),
    diff: "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n",
    ...overrides,
  };
  let pushes = 0;
  let prs = 0;
  await page.route("**/api/plugins", (route) =>
    route.fulfill({
      json: [
        {
          namespace: "repoflow.repositories",
          viewer_id: "default",
          module: "repoflow.repositories.v1",
          title: "Repositories",
          description: "",
          settings: { enabled: true },
          entry: assets + "index.mjs",
          transport: "assets-v1",
          backend_actions: [
            "current",
            "review",
            "publication",
            "publication-options",
            "configure-publication",
            "push",
            "create-pr",
            "history",
            "history-diff",
            "execution",
            "repositories",
            "conversation-branches",
            "test-settings",
            "clones",
          ],
        },
      ],
    }),
  );
  await page.route(`**${assets}*`, (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    if (
      ![
        "index.mjs",
        "account.mjs",
        "ssh.mjs",
        "icons.mjs",
        "workflow.mjs",
        "publication.mjs",
        "history.mjs",
        "diff.mjs",
        "styles.css",
      ].includes(name)
    )
      throw new Error(name);
    return route.fulfill({
      body: readFileSync(path.join(directory, name)),
      contentType: name.endsWith("css") ? "text/css" : "application/javascript",
    });
  });
  await page.route(
    "**/api/plugins/repoflow.repositories/actions/*",
    async (route) => {
      const action = new URL(route.request().url()).pathname.split("/").pop();
      const fields = route.request().postDataJSON() as Record<string, unknown>;
      let result: unknown = data;
      if (action === "repositories")
        result = [
          {
            id: data.repository,
            fork: data.fork,
            target: data.target,
            base: "master",
          },
        ];
      if (action === "execution") result = { hosts: [] };
      if (action === "conversation-branches") result = {};
      if (action === "test-settings") result = { command: "", directory: "" };
      if (action === "clones") result = [];
      if (action === "publication")
        result = !queued
          ? {}
          : data.publication
            ? data
            : {
                publication: {
                  id: "queued-request",
                  state: "waiting_for_review",
                },
              };
      if (action === "history")
        result = {
          entries: [
            {
              commit: "c".repeat(40),
              time: "2026-11-19T03:00:00Z",
              stage: "tool: edit_file",
              file_count: 1,
              files: ["a"],
            },
          ],
          next_page: null,
          total: 1,
        };
      if (action === "history-diff") result = { diff: "+checkpoint-change" };
      if (action === "publication-options")
        result = {
          targets: [
            {
              repository: "alice/fork",
              default_branch: "master",
              branches: ["master"],
            },
            {
              repository: "upstream/repo",
              default_branch: "master",
              branches: ["master"],
            },
          ],
        };
      if (action === "configure-publication") {
        data = { ...data, ...fields };
        result = data;
      }
      if (action === "push") {
        pushes++;
        data = {
          ...data,
          published_commit: data.commit,
          publication: { id: "queued-request", state: "pushed" },
          pr_form_url: `https://github.com/${String(data.target)}/compare/master...alice:repoflow%2F${MOCK_THREAD_ID}?quick_pull=1`,
        };
        result = data;
      }
      if (action === "create-pr") {
        prs++;
        expect(fields.draft).toBe(true);
        expect(fields.confirmed).toBe(true);
        data = {
          ...data,
          pull_request: {
            number: 42,
            url: `https://github.com/${String(data.target)}/pull/42`,
            draft: true,
          },
        };
        result = data;
      }
      await route.fulfill({ json: result });
    },
  );
  return { activity: () => ({ pushes, prs }) };
}

for (const create of [false, true])
  test(`publication selects targets and ${create ? "creates a draft only after confirmation" : "stops at the official PR form link"}`, async ({
    page,
  }, testInfo) => {
    const { activity } = await mockPublication(page, !create);
    await page.goto(`/workspace/chats/${MOCK_THREAD_ID}`);
    if (create)
      await page
        .getByRole("button", { name: "View changes", exact: true })
        .click();
    const panel = page.getByRole("region", { name: "Git review", exact: true });
    await expect(panel).toBeVisible();
    await panel
      .getByRole("button", { name: "Change history", exact: true })
      .click();
    await panel.getByRole("button", { name: /^cccccccccccc/ }).click();
    await expect(
      panel.getByText("+checkpoint-change", { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Publish / PR", exact: true })
      .click();
    await expect(panel.getByLabel("PR title", { exact: true })).toHaveValue(
      "Reviewed fix",
    );
    if (create)
      await panel
        .getByLabel("PR target repository", { exact: true })
        .selectOption("alice/fork");
    await panel
      .getByRole("button", { name: "Push to my fork", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Confirm push", exact: true }),
    ).toBeVisible();
    expect(activity().pushes).toBe(0);
    expect(activity().prs).toBe(0);
    await panel
      .getByRole("button", { name: "Confirm push", exact: true })
      .click();
    await expect.poll(() => activity().pushes).toBe(1);
    await expect(
      panel.getByRole("link", {
        name: create
          ? "Open my repository PR form ↗"
          : "Open official repository PR form ↗",
        exact: true,
      }),
    ).toHaveAttribute(
      "href",
      new RegExp(
        create
          ? "github.com/alice/fork/compare/"
          : "github.com/upstream/repo/compare/",
      ),
    );
    expect(activity().prs).toBe(0);
    const controls = panel.locator(".repo-publication");
    const pushed = controls.getByRole("button", {
      name: "Pushed to my fork",
      exact: true,
    });
    await expect(pushed).toBeDisabled();
    for (const width of [420, 900, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.goto(`/workspace/chats/${MOCK_THREAD_ID}`);
      await page
        .getByRole("button", { name: "View changes", exact: true })
        .click();
      await panel
        .getByRole("button", { name: "Publish / PR", exact: true })
        .click();
      const buttons = controls.getByRole("button");
      await expect(buttons).toHaveCount(6);
      for (const button of await buttons.all()) {
        expect(await button.innerText()).not.toMatch(/…|\.\.\./);
        expect((await button.getAttribute("title"))?.length).toBeGreaterThan(
          12,
        );
        await button.hover();
        expect(
          await button.evaluate(
            (node) => node.scrollWidth <= node.clientWidth + 1,
          ),
        ).toBe(true);
      }
      expect(
        await controls.evaluate(
          (node) => node.scrollWidth <= node.clientWidth + 1,
        ),
      ).toBe(true);
    }
    await controls
      .getByRole("button", { name: "Create PR", exact: true })
      .scrollIntoViewIfNeeded();
    await panel.screenshot({
      path: testInfo.outputPath("publication-controls.png"),
    });
    await page.screenshot({
      path: testInfo.outputPath("workspace-overview.png"),
    });
    if (create) {
      await panel
        .getByRole("button", { name: "Create draft PR", exact: true })
        .click();
      expect(activity().prs).toBe(0);
      await expect(
        panel.getByRole("button", { name: "Confirm draft PR", exact: true }),
      ).toBeDisabled();
      await panel
        .getByRole("checkbox", { name: /I confirm creating a PR/ })
        .check();
      await panel
        .getByRole("button", { name: "Confirm draft PR", exact: true })
        .click();
      await expect(
        panel.getByRole("link", { name: "Created draft PR #42", exact: true }),
      ).toBeVisible();
      expect(activity().prs).toBe(1);
    }
  });
