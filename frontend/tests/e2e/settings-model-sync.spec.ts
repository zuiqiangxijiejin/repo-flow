import { expect, test } from "@playwright/test";

import { mockLangGraphAPI, MOCK_THREAD_ID } from "./utils/mock-api";

for (const agent of [false, true]) {
  for (const field of ["effort", "mode"] as const) {
    test(`${agent ? "agent" : "normal"} thread ${field} selection preserves the account model`, async ({
      page,
    }) => {
      mockLangGraphAPI(page, {
        agents: [{ name: "researcher", description: "Research agent" }],
        threads: [
          {
            thread_id: MOCK_THREAD_ID,
            agent_name: agent ? "researcher" : undefined,
          },
        ],
      });
      await page.addInitScript(
        ({ threadId }) => {
          localStorage.setItem(
            `deerflow.thread-model.${threadId}`,
            "thread-model",
          );
        },
        { threadId: MOCK_THREAD_ID },
      );
      await page.route("**/api/models", (route) =>
        route.fulfill({
          json: {
            models: [
              {
                name: "account-model",
                display_name: "Account Model",
                supports_thinking: true,
                supports_reasoning_effort: true,
              },
              {
                name: "thread-model",
                display_name: "Thread Model",
                supports_thinking: true,
                supports_reasoning_effort: true,
              },
            ],
          },
        }),
      );
      await page.route("**/api/v1/auth/me", (route) =>
        route.fulfill({
          json: {
            id: "00000000-0000-0000-0000-000000000028",
            email: "thread@example.com",
            system_role: "admin",
            needs_setup: false,
          },
        }),
      );
      const patches: unknown[] = [];
      let reads = 0;
      let server = {
        model_name: "account-model",
        mode: "pro",
        reasoning_effort: "medium",
        notification_enabled: true,
        // The account already has the UI language, so only the edits below are sent.
        locale: "en-US",
      };
      await page.route("**/api/v1/auth/preferences", async (route) => {
        if (route.request().method() === "PATCH") {
          const patch = route.request().postDataJSON() as Partial<
            typeof server
          >;
          patches.push(patch);
          server = { ...server, ...patch };
          await route.fulfill({ status: 204 });
        } else {
          reads++;
          await route.fulfill({ json: server });
        }
      });
      await page.goto(
        `/workspace/${agent ? "agents/researcher/chats" : "chats"}/${MOCK_THREAD_ID}`,
      );
      await expect(page.getByTestId("composer-toolbar")).toBeVisible();
      await page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      await expect.poll(() => reads).toBeGreaterThan(0);
      await expect(
        page.getByRole("button", { name: "Thread Model", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Reasoning Effort: Medium",
          exact: true,
        }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Pro", exact: true }).click();
      if (field === "effort") {
        await page.getByRole("menuitem", { name: /^Reasoning Effort/ }).click();
        await expect(
          page.getByRole("menuitemradio", { name: /^Medium/ }),
        ).toHaveAttribute("aria-checked", "true");
        await page.getByRole("menuitemradio", { name: /^High/ }).click();
      } else {
        await page
          .getByRole("menuitem")
          .filter({ hasText: /^Ultra/ })
          .click();
      }
      await expect
        .poll(() => patches)
        .toEqual([
          field === "effort"
            ? { reasoning_effort: "high" }
            : { mode: "ultra", reasoning_effort: "high" },
        ]);
      expect(server.model_name).toBe("account-model");
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Thread Model", exact: true }),
      ).toBeVisible();
    });
  }
}

test("custom agent automatic default does not become an account preference", async ({
  page,
}) => {
  mockLangGraphAPI(page, {
    agents: [{ name: "researcher", description: "Research agent" }],
  });
  const patches: unknown[] = [];
  let reads = 0;
  let allowModels!: () => void;
  const modelsReady = new Promise<void>((resolve) => {
    allowModels = resolve;
  });
  await page.route("**/api/agents/researcher", (route) =>
    route.fulfill({
      json: {
        name: "researcher",
        description: "Research agent",
        model: "agent-model",
        system_prompt: "Research",
        tools: [],
        skills: [],
      },
    }),
  );
  await page.route("**/api/models", async (route) => {
    // Do not let the auth-disabled fixture select a model before the account
    // is activated. The real agent page must then choose its configured model.
    await modelsReady;
    await route.fulfill({
      json: {
        models: [
          {
            name: "first-model",
            display_name: "First Model",
            supports_thinking: true,
          },
          {
            name: "agent-model",
            display_name: "Agent Model",
            supports_thinking: true,
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      json: {
        id: "00000000-0000-0000-0000-000000000027",
        email: "agent@example.com",
        system_role: "admin",
        needs_setup: false,
      },
    }),
  );
  await page.route("**/api/v1/auth/preferences", async (route) => {
    if (route.request().method() === "PATCH") {
      patches.push(route.request().postDataJSON());
      await route.fulfill({ status: 204 });
    } else {
      reads++;
      await route.fulfill({
        json: {
          model_name: null,
          mode: null,
          reasoning_effort: null,
          notification_enabled: true,
          locale: "en-US",
        },
      });
    }
  });
  await page.goto("/workspace/agents/researcher/chats/new");
  await page
    .locator("[data-sidebar='sidebar']")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(settings).not.toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect.poll(() => reads).toBe(1);
  await expect(page.getByText("Research agent", { exact: true })).toBeVisible();
  allowModels();
  await expect(
    page.getByRole("button", { name: "Agent Model", exact: true }),
  ).toBeVisible();
  // Flush the local outbox cycle through a completed server read, so this also
  // catches a PATCH that would otherwise arrive just after the UI assertion.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBe(2);
  expect(patches).toEqual([]);
  // Explicit model selections on this same page must still be synchronized.
  await page.getByRole("button", { name: "Agent Model", exact: true }).click();
  await page
    .getByRole("button", { name: "First Model (first-model)", exact: true })
    .click();
  await expect.poll(() => patches).toEqual([{ model_name: "first-model" }]);
});

test("automatic model fallback cannot overwrite a slowly loaded account preference", async ({
  page,
}) => {
  mockLangGraphAPI(page);
  const patches: unknown[] = [];
  let requested = false;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        models: [
          { name: "model-a", display_name: "Model A", supports_thinking: true },
          { name: "model-b", display_name: "Model B", supports_thinking: true },
        ],
      },
    }),
  );
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      json: {
        id: "00000000-0000-0000-0000-000000000026",
        email: "model@example.com",
        system_role: "admin",
        needs_setup: false,
      },
    }),
  );
  await page.route("**/api/v1/auth/preferences", async (route) => {
    if (route.request().method() === "PATCH") {
      patches.push(route.request().postDataJSON());
      await route.fulfill({ status: 204 });
      return;
    }
    requested = true;
    await delayed;
    await route.fulfill({
      json: {
        model_name: "model-b",
        mode: "pro",
        reasoning_effort: "high",
        notification_enabled: true,
        locale: "en-US",
      },
    });
  });
  await page.goto("/workspace/chats/new");
  // Wait for actual hydration before refreshing the auth-disabled fixture's
  // AuthProvider into a session account with a deliberately slow preference GET.
  await page
    .locator("[data-sidebar='sidebar']")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(settings).not.toBeVisible();
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect.poll(() => requested).toBe(true);
  await expect(
    page.getByRole("button", { name: "Model A", exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("button", { name: "Model B", exact: true }),
  ).toBeVisible();
  expect(patches).toEqual([]);
});

test("switching to a reasoning model keeps full names and aligned composer controls", async ({
  page,
}) => {
  mockLangGraphAPI(page, { threads: [{ thread_id: MOCK_THREAD_ID }] });
  const reasoningModel = "Alibaba Cloud Bailian / Qwen (China) · qwen3.8-flash";
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        models: [
          { name: "plain", display_name: "Plain Model" },
          {
            name: "qwen3.8-flash",
            display_name: reasoningModel,
            supports_thinking: true,
            supports_reasoning_effort: true,
          },
        ],
      },
    }),
  );
  await page.goto(`/workspace/chats/${MOCK_THREAD_ID}`);
  await page.addStyleTag({
    content: ".repoflow-composer { max-width: 520px; }",
  });
  const footer = page.getByTestId("composer-toolbar");
  const modelPicker = footer.getByRole("button", { name: "Plain Model" });
  await expect(modelPicker).toBeVisible({ timeout: 20_000 });
  // The label itself must sit beside the mode control, rather than sitting
  // in the middle of an otherwise empty, stretched model button.
  const shortLabel = (await modelPicker.locator("span").first().boundingBox())!;
  const shortMode = (await footer
    .getByRole("button", { name: /^(Flash|Pro)$/ })
    .boundingBox())!;
  expect(shortMode.x - shortLabel.x - shortLabel.width).toBeLessThanOrEqual(20);
  const toolbarHeight = await footer.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await modelPicker.click();
  await page
    .getByRole("button", {
      name: `${reasoningModel} (qwen3.8-flash)`,
      exact: true,
    })
    .click();
  await footer.getByRole("button", { name: /^(Flash|Pro)$/ }).click();
  await page.getByRole("menuitem", { name: /^Reasoning/ }).click();
  await expect(
    footer.getByRole("button", { name: "Reasoning", exact: true }),
  ).toBeVisible();
  const selectedModel = footer.getByRole("button", {
    name: reasoningModel,
    exact: true,
  });
  await expect(selectedModel).toBeVisible();
  expect(
    await selectedModel.evaluate(
      (node) => node.scrollWidth <= node.clientWidth + 1,
    ),
  ).toBe(true);
  expect(
    await footer.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  expect((await footer.boundingBox())!.height).toBeGreaterThanOrEqual(
    toolbarHeight,
  );
  const modelBox = (await selectedModel.boundingBox())!;
  const modeBox = (await footer
    .getByRole("button", { name: "Reasoning", exact: true })
    .boundingBox())!;
  const sendBox = (await footer
    .getByRole("button", { name: "Submit", exact: true })
    .boundingBox())!;
  expect(modeBox.x).toBeGreaterThanOrEqual(modelBox.x + modelBox.width - 1);
  expect(sendBox.x).toBeGreaterThanOrEqual(modeBox.x + modeBox.width - 1);
  await expect
    .poll(() =>
      footer.evaluate((element) => getComputedStyle(element).flexDirection),
    )
    .toBe("row");
});

test("mode menu uses English names and highlights the selected mode in Chinese", async ({
  page,
}) => {
  mockLangGraphAPI(page, { threads: [{ thread_id: MOCK_THREAD_ID }] });
  await page.addInitScript(() => {
    document.cookie = "locale=zh-CN; path=/";
  });
  await page.route("**/api/models", (route) =>
    route.fulfill({
      json: {
        models: [
          {
            name: "reasoning-model",
            display_name: "Reasoning model",
            supports_thinking: true,
          },
        ],
      },
    }),
  );

  await page.goto(`/workspace/chats/${MOCK_THREAD_ID}`);
  const footer = page.getByTestId("composer-toolbar");
  await expect(
    footer.getByRole("button", { name: "Reasoning model", exact: true }),
  ).toBeVisible();
  await footer.getByRole("button", { name: /^(Flash|Pro)$/ }).click();

  const menu = page.getByRole("menu");
  for (const name of ["Flash", "Reasoning", "Pro", "Ultra"]) {
    await expect(menu.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(
    menu.getByText("可调用子代理分工，适合可拆分的复杂任务。"),
  ).toBeVisible();
  const pro = menu.getByRole("menuitem", { name: /^Pro / });
  await expect(pro.locator("svg.lucide-list-checks")).toBeVisible();
  await pro.click();

  await footer.getByRole("button", { name: "Pro", exact: true }).click();
  await expect(pro).toHaveAttribute("aria-current", "true");
  await expect(pro.locator("svg.lucide-check")).toBeVisible();
  const flash = menu.getByRole("menuitem", { name: /^Flash / });
  await expect(flash).not.toHaveAttribute("aria-current", "true");
  await expect(flash.locator("svg.lucide-check")).toBeHidden();
});
