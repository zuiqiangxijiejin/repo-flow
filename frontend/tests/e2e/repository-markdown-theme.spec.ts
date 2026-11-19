import { expect, test } from "@playwright/test";

import { mockLangGraphAPI, MOCK_THREAD_ID } from "./utils/mock-api";

const content = `已核对当前修改：

| 位置 | 改动 | 原因 |
| --- | --- | --- |
| \`parse_func()\` | 改为 \`parse_func(dtstr)\` | 调用时传入日期字符串 |
| Problem 2 脚本 | 补回 \`from datetime import datetime\` | 测试用例需要导入 |

\`\`\`
M  docs/exercises/index.rst
A  docs/exercises/solutions/parsing-tzname.rst
\`\`\`

\`\`\`python
def parse_date(text: str):
    return parse(text)
\`\`\`
`;

for (const theme of ["light", "dark"] as const) {
  test(`repository Markdown shares the ${theme} palette in blocks and fullscreen`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: MOCK_THREAD_ID,
          title: "统一表格与代码块样式",
          messages: [
            { type: "human", id: "theme-human", content: "检查这次修改" },
            { type: "ai", id: "theme-answer", content },
          ],
        },
      ],
    });
    await page.goto(`/workspace/chats/${MOCK_THREAD_ID}`);
    const table = page.locator('[data-streamdown="table-wrapper"]');
    const code = page.locator('[data-streamdown="code-block"]');
    await expect(table).toBeVisible();
    await expect(code).toHaveCount(2);
    const palette = await page
      .locator(".repoflow-workspace")
      .evaluate((root) => {
        const probe = document.createElement("div");
        root.append(probe);
        const resolve = (token: string) => {
          probe.style.backgroundColor = `var(${token})`;
          return getComputedStyle(probe).backgroundColor;
        };
        const result = {
          panel: resolve("--repoflow-review"),
          content: resolve("--repoflow-chat"),
          ink: resolve("--repoflow-ink"),
          border: resolve("--repoflow-outline"),
        };
        probe.remove();
        return result;
      });
    await expect(table).toHaveCSS("background-color", palette.panel);
    for (const block of await code.all()) {
      await expect(block).toHaveCSS("background-color", palette.panel);
      await expect(block).toHaveCSS("border-top-color", palette.border);
    }
    await expect(
      code.first().locator('[data-streamdown="code-block-body"]'),
    ).toHaveCSS("background-color", palette.content);
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar).not.toHaveCSS("background-color", palette.panel);
    const tokens = code.last().locator("code span[style]");
    await expect.poll(() => tokens.count()).toBeGreaterThan(1);
    await expect
      .poll(async () =>
        new Set(
          await tokens.evaluateAll((nodes) =>
            nodes.map((node) => getComputedStyle(node).color),
          ),
        ).size,
      )
      .toBeGreaterThan(1);
    await table.screenshot({ path: testInfo.outputPath(`table-${theme}.png`) });
    await code.first().screenshot({
      path: testInfo.outputPath(`code-${theme}.png`),
    });

    await table.getByRole("button", { name: "View fullscreen" }).click();
    const fullscreen = page.locator('[data-streamdown="table-fullscreen"]');
    await expect(fullscreen).toBeVisible();
    await expect(fullscreen).toHaveCSS("background-color", palette.content);
    await expect(fullscreen).toHaveCSS("color", palette.ink);
    await expect(fullscreen.locator("th").first()).toHaveCSS(
      "border-top-color",
      palette.border,
    );
    await fullscreen.screenshot({
      path: testInfo.outputPath(`fullscreen-${theme}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(fullscreen).toHaveCount(0);
  });
}
