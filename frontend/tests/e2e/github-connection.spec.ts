import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const namespace = "repoflow.repositories";
const assets = `/api/plugins/${namespace}/assets/${"a".repeat(64)}/static/`;
const source = path.resolve(
  process.cwd(),
  "../examples/deerflow-extension-repository-tasks/repoflow_repository_tasks/static",
);

async function mockGitHub(page: Page) {
  mockLangGraphAPI(page);
  let connected = false;
  let pending = false;
  let submittedToken = "";
  let hosts: Record<string, unknown>[] = [];
  const status = () => ({
    connected,
    account: connected ? { login: "alice" } : null,
    browser_available: true,
    authorization: pending ? { state: "pending", code: "ABCD-1234" } : null,
  });
  await page.route("**/api/plugins", (route) =>
    route.fulfill({
      json: [
        {
          namespace,
          viewer_id: "default",
          module: "repoflow.repositories.v1",
          title: "Repositories",
          description: "GitHub repositories",
          settings: { enabled: true },
          backend_actions: [
            "github-status",
            "github-login",
            "github-token",
            "github-disconnect",
            "github-check",
            "github-cancel",
            "github-repositories",
            "github-repository",
            "validate-links",
            "repositories",
            "conversation-branches",
            "execution",
            "current",
            "ssh-probe",
            "ssh-save",
            "ssh-test",
            "ssh-delete",
            "connect",
          ],
          transport: "assets-v1",
          entry: assets + "index.mjs",
        },
      ],
    }),
  );
  await page.route(`**${assets}*`, async (route) => {
    const filename = new URL(route.request().url()).pathname.split("/").pop()!;
    if (
      ![
        "index.mjs",
        "account.mjs",
        "ssh.mjs",
        "icons.mjs",
        "workflow.mjs",
        "diff.mjs",
        "publication.mjs",
        "history.mjs",
        "styles.css",
      ].includes(filename)
    )
      throw new Error(filename);
    await route.fulfill({
      body: readFileSync(path.join(source, filename)),
      contentType: filename.endsWith("css")
        ? "text/css"
        : "application/javascript",
    });
  });
  await page.route(`**/api/plugins/${namespace}/actions/*`, async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").pop();
    if (action === "github-login") pending = true;
    if (action === "github-cancel") pending = false;
    if (action === "github-token") {
      submittedToken = (route.request().postDataJSON() as { token: string })
        .token;
      connected = true;
      pending = false;
    }
    if (action === "github-disconnect") connected = false;
    let result: unknown = status();
    if (action === "github-repositories")
      result = {
        repositories: [
          { name: "alice/private", can_push: true },
          { name: "alice/fork", can_push: true },
          { name: "upstream/project", can_push: false },
        ],
        next_page: null,
      };
    if (action === "github-repository") {
      const fields = route.request().postDataJSON() as { repository: string };
      result = {
        parent: fields.repository === "alice/fork" ? "upstream/project" : null,
      };
    }
    if (action === "validate-links") result = { valid: true };
    if (action === "github-check") result = { ...status(), verified: true };
    if (action === "repositories" || action === "conversation-branches")
      result = [];
    if (action === "execution")
      result = { hosts: hosts.map((host) => host.id), profiles: hosts };
    if (action === "ssh-probe")
      result = {
        host_keys: "offline-public-key",
        fingerprints: ["SHA256:fixture"],
      };
    if (action === "ssh-save") {
      const fields = {
        ...(route.request().postDataJSON() as Record<string, unknown>),
      };
      delete fields.secret;
      delete fields.host_keys;
      delete fields.trust_host;
      hosts = [{ ...fields, id: "test-host" }];
      result = hosts[0];
    }
    if (action === "ssh-test") result = { connected: true };
    if (action === "ssh-delete") {
      hosts = [];
      result = { deleted: true };
    }
    if (action === "connect")
      result = { connected: true, origin: "https://remote.example.test" };
    if (action === "current") result = null;
    await route.fulfill({ json: result });
  });
  return {
    approve() {
      connected = true;
      pending = false;
    },
    token() {
      return submittedToken;
    },
  };
}

test("project picker precedes contribution details and supports own projects and forks", async ({
  page,
}) => {
  const github = await mockGitHub(page);
  github.approve();
  await page.goto("/workspace/chats/new");
  await page
    .getByRole("button", { name: "+ Add repository", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Attach a GitHub repository",
    exact: true,
  });
  const picker = dialog.getByRole("combobox", {
    name: "Choose my GitHub project (including forks, optional)",
    exact: true,
  });
  const contribution = dialog.getByLabel("Contribution repository URL", {
    exact: true,
  });
  const upstream = dialog.getByLabel(
    "PR target repository URL (upstream, optional)",
    { exact: true },
  );
  await expect(picker.locator('option[value="alice/fork"]')).toHaveCount(1);
  expect(
    await picker.evaluate((element) =>
      Boolean(
        element.compareDocumentPosition(
          element.closest(".repo-fields")!.querySelector("input")!,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ),
  ).toBe(true);
  await picker.selectOption("alice/fork");
  await expect(contribution).toHaveValue("https://github.com/alice/fork");
  await expect(upstream).toHaveValue("https://github.com/upstream/project");
  await picker.selectOption("alice/private");
  await expect(contribution).toHaveValue("https://github.com/alice/private");
  await expect(upstream).toHaveValue("");
  await expect(dialog).toContainText(
    "Use your own project directly without creating a fork.",
  );
});

test("personal token connects the account, lists repository permissions and disconnects", async ({
  page,
}) => {
  const github = await mockGitHub(page);
  await page.goto("/workspace/chats/new?settings=connections");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "GitHub", exact: true }),
  ).toBeVisible();
  await dialog
    .getByText("Connect with an access token", { exact: true })
    .click();
  const input = dialog.getByLabel("GitHub Token", { exact: true });
  await input.fill("github_pat_offline_browser_test");
  await dialog
    .getByRole("button", { name: "Verify and connect", exact: true })
    .click();
  await expect(dialog.getByText("@alice", { exact: true })).toBeVisible();
  expect(github.token()).toBe("github_pat_offline_browser_test");
  await expect(input).toHaveCount(0);
  await expect(dialog).not.toContainText("github_pat_offline_browser_test");
  await dialog
    .getByText("View accessible repositories", { exact: true })
    .click();
  await expect(
    dialog.getByText("alice/private", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog
      .locator(".repo-account-repository")
      .filter({ hasText: "alice/private" })
      .getByText("Write access", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("Read only", { exact: true })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Verify connection", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "GitHub connection verified.",
  );
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Connect GitHub", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("@alice", { exact: true })).toHaveCount(0);
});

test("browser authorization displays GitHub's code and polls the connected account", async ({
  page,
}) => {
  const github = await mockGitHub(page);
  await page.goto("/workspace/chats/new?settings=connections");
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Connect GitHub", exact: true })
    .click();
  await expect(dialog.getByText("ABCD-1234", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Authorize on GitHub ↗", exact: true }),
  ).toHaveAttribute("href", "https://github.com/login/device");
  github.approve();
  await expect(dialog.getByText("@alice", { exact: true })).toBeVisible();
  await expect(dialog.getByText("ABCD-1234", { exact: true })).toHaveCount(0);
});

for (const width of [420, 1440])
  test(`SSH entry configures an account host, tests it and removes it at ${width}px`, async ({
    page,
  }, testInfo) => {
    await mockGitHub(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/workspace/chats/new");
    await expect(
      page
        .getByRole("region", { name: "GitHub repository", exact: true })
        .getByRole("button", { name: "Attach repository", exact: true }),
    ).toBeVisible();
    if (width < 768)
      await page
        .getByRole("button", { name: "Toggle Sidebar", exact: true })
        .first()
        .click();
    await page
      .getByRole("button", { name: "SSH connections", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "SSH host configuration",
      exact: true,
    });
    await expect(
      dialog.getByText("No hosts yet. Add one below.", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByLabel("Host name", { exact: true })
      .fill("My development host");
    await dialog
      .getByLabel("Host address", { exact: true })
      .fill("dev.example.test");
    await dialog.getByLabel("SSH username", { exact: true }).fill("alice");
    await dialog
      .getByLabel("Authentication", { exact: true })
      .selectOption("password");
    await dialog
      .getByLabel("SSH password", { exact: true })
      .fill("offline-password");
    await dialog
      .getByLabel("Remote RepoFlow URL", { exact: true })
      .fill("https://remote.example.test");
    const save = dialog.getByRole("button", { name: "Save host", exact: true });
    await expect(save).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Read host fingerprint", exact: true })
      .click();
    await expect(
      dialog.getByText("SHA256:fixture", { exact: true }),
    ).toBeVisible();
    await expect(save).toBeDisabled();
    await dialog
      .getByRole("checkbox", {
        name: "I verified and trust this host fingerprint",
        exact: true,
      })
      .check();
    await save.click();
    await expect(
      dialog.getByLabel("SSH password", { exact: true }),
    ).toBeHidden();
    await dialog
      .getByRole("button", { name: "Test SSH connection", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      "SSH authentication and host fingerprint verified",
    );
    await dialog.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(
      dialog.getByLabel("Host address", { exact: true }),
    ).toHaveValue("dev.example.test");
    await expect(
      dialog.getByLabel("SSH password", { exact: true }),
    ).toHaveValue("");
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    await dialog.screenshot({
      path: testInfo.outputPath("ssh-host-configuration.png"),
    });
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      dialog.getByText("No hosts yet. Add one below.", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
