import { expect, rs, test } from "@rstest/core";

import { type PluginSurface } from "@/core/extensions/contracts";
import { mountSurface } from "@/core/extensions/surfaces";

import repositories from "../../../../../examples/deerflow-extension-repository-tasks/repoflow_repository_tasks/static/index.mjs";

const surface = repositories.surfaces.find(
  ({ id }) => id === "review",
)! as PluginSurface;
const initial = {
  thread: "thread",
  fork: "alice/fork",
  target: "upstream/repo",
  upstream_target: "upstream/repo",
  base_branch: "master",
  branch: "repoflow/thread",
  commit: "a".repeat(40),
  title: "Reviewed fix",
  pr_body: "Description",
  diff: "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n",
  publication_revision: "revision",
};

test("large diffs render in batches and preserve every remaining line", async () => {
  const container = document.createElement("div");
  const patch =
    "diff --git a/large.py b/large.py\n--- a/large.py\n+++ b/large.py\n@@ -0,0 +1,450 @@\n" +
    Array.from({ length: 450 }, (_, index) => `+line_${index}`).join("\n") +
    "\n";
  const dispose = mountSurface(
    container,
    surface,
    {
      namespace: "repoflow.repositories",
      locale: "en",
      settings: {},
      threadId: "thread",
      callBackend: async () => ({ ...initial, diff: patch }),
    },
    () => {
      throw new Error("Mount failed");
    },
  );
  const root = container.shadowRoot!;
  try {
    await rs.waitFor(() =>
      expect(root.querySelectorAll(".repo-diff-line")).toHaveLength(200),
    );
    expect(root.textContent).toContain("450");
    const more = root.querySelector<HTMLButtonElement>(".repo-diff-more")!;
    more.click();
    expect(root.querySelectorAll(".repo-diff-line")).toHaveLength(400);
    more.click();
    expect(root.querySelectorAll(".repo-diff-line")).toHaveLength(451);
    expect(more.hidden).toBe(true);
    expect(root.textContent).toContain("+line_449");
  } finally {
    dispose();
  }
});

for (const state of ["open", "closed"])
  test(`PR fields and all actions remain visible after changing target with a ${state} PR`, async () => {
    const container = document.createElement("div");
    const record = {
      ...initial,
      published_commit: initial.commit,
      pull_request: {
        number: 42,
        url: "https://github.com/upstream/repo/pull/42",
        state,
        draft: true,
      },
    };
    const callBackend = rs.fn(async (action: string) =>
      action === "publication-options" ? { targets: [] } : record,
    );
    const dispose = mountSurface(
      container,
      surface,
      {
        namespace: "repoflow.repositories",
        locale: "en",
        settings: {},
        threadId: "thread",
        callBackend,
      },
      () => {
        throw new Error("Mount failed");
      },
    );
    const root = container.shadowRoot!;
    try {
      await rs.waitFor(() =>
        expect(root.textContent).toContain("Publish / PR"),
      );
      Array.from(root.querySelectorAll("button"))
        .find((node) => node.textContent === "Publish / PR")!
        .click();
      const form = root.querySelector(".repo-publication")!;
      const create = Array.from(form.querySelectorAll("button")).find(
        (node) => node.textContent === "Create PR",
      )!;
      expect(create.disabled).toBe(state === "open");
      const target = form.querySelector("select")!;
      target.value = "alice/fork";
      target.dispatchEvent(new Event("change"));
      expect(form.querySelectorAll("button")).toHaveLength(6);
      expect(form.querySelector("textarea")!.value).toBe("Description");
      expect(form.querySelectorAll("input")[1]!.value).toBe("Reviewed fix");
      expect(form.textContent).toContain("#42");
      expect(create.disabled).toBe(true);
      expect(create.title).toContain("Save changed PR details first");
    } finally {
      dispose();
    }
  });

test("review waits for the run and automatically recovers when it becomes idle", async () => {
  const container = document.createElement("div");
  let running = true;
  let notify: ((running: boolean) => void) | undefined;
  const callBackend = rs.fn(async () => initial);
  const unsubscribe = rs.fn();
  const dispose = mountSurface(
    container,
    surface,
    {
      namespace: "repoflow.repositories",
      locale: "en",
      settings: {},
      threadId: "thread",
      callBackend,
      isThreadRunning: () => running,
      subscribeThreadActivity: (listener) => {
        notify = listener;
        return unsubscribe;
      },
    },
    () => {
      throw new Error("Mount failed");
    },
  );
  try {
    expect(container.shadowRoot!.textContent).toContain(
      "Waiting for the Agent",
    );
    expect(callBackend).not.toHaveBeenCalled();
    running = false;
    notify!(false);
    await rs.waitFor(() =>
      expect(container.shadowRoot!.textContent).toContain("Reviewed fix"),
    );
    expect(callBackend).toHaveBeenCalledWith("review", { id: "thread" });
  } finally {
    dispose();
  }
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("push and PR creation have independent confirmations with the selected fork target", async () => {
  const container = document.createElement("div");
  let record = { ...initial };
  const callBackend = rs.fn(
    async (action: string, fields: Record<string, unknown>) => {
      if (action === "review") return record;
      if (action === "publication-options")
        return {
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
        record = { ...record, ...fields } as typeof record;
        return record;
      }
      if (action === "push")
        return {
          ...record,
          published_commit: record.commit,
          pr_form_url:
            "https://github.com/alice/fork/compare/master...repoflow%2Fthread?quick_pull=1",
        };
      if (action === "create-pr")
        return {
          ...record,
          published_commit: record.commit,
          pull_request: {
            number: 42,
            draft: true,
            url: "https://github.com/alice/fork/pull/42",
          },
        };
      throw new Error(action);
    },
  );
  const dispose = mountSurface(
    container,
    surface,
    {
      namespace: "repoflow.repositories",
      locale: "en",
      settings: {},
      threadId: "thread",
      callBackend,
    },
    () => {
      throw new Error("Mount failed");
    },
  );
  const root = container.shadowRoot!;
  const button = (label: string) =>
    Array.from(root.querySelectorAll("button")).find(
      (node) => node.textContent === label,
    )!;
  try {
    await rs.waitFor(() => expect(root.textContent).toContain("Publish / PR"));
    button("Publish / PR").click();
    const target = root.querySelector("select")!;
    target.value = "alice/fork";
    target.dispatchEvent(new Event("change"));
    button("Push to my fork").click();
    await rs.waitFor(() =>
      expect(root.textContent).toContain("Confirm pushing this commit"),
    );
    expect(callBackend.mock.calls.some(([name]) => name === "push")).toBe(
      false,
    );
    button("Confirm push").click();
    await rs.waitFor(() =>
      expect(root.textContent).toContain("Pushed to alice/fork"),
    );
    expect(
      root.querySelector<HTMLAnchorElement>(".repo-publication-result a")?.href,
    ).toContain("github.com/alice/fork/compare/");
    expect(callBackend.mock.calls.some(([name]) => name === "create-pr")).toBe(
      false,
    );
    button("Create draft PR").click();
    expect(callBackend.mock.calls.some(([name]) => name === "create-pr")).toBe(
      false,
    );
    expect(button("Confirm draft PR").disabled).toBe(true);
    const acknowledgement = root.querySelector<HTMLInputElement>(
      "dialog input[type=checkbox]",
    )!;
    acknowledgement.checked = true;
    acknowledgement.dispatchEvent(new Event("change"));
    button("Confirm draft PR").click();
    await rs.waitFor(() =>
      expect(root.textContent).toContain("Created draft PR #42"),
    );
    expect(callBackend).toHaveBeenCalledWith("create-pr", {
      id: "thread",
      commit: initial.commit,
      revision: "revision",
      draft: true,
      confirmed: true,
    });
  } finally {
    dispose();
  }
});

test("published buttons have complete labels and help, and saving never reenables push", async () => {
  const container = document.createElement("div");
  let record = {
    ...initial,
    published_commit: initial.commit,
    pr_body: "完整说明".repeat(400),
    pr_form_url:
      "https://github.com/upstream/repo/compare/master...alice:branch",
    publication: { state: "pushed" },
  };
  const callBackend = rs.fn(async (action: string, fields: unknown) => {
    if (action === "review") return record;
    if (action === "publication-options") return { targets: [] };
    if (action === "configure-publication") {
      record = { ...record, ...(fields as object) };
      return record;
    }
    throw new Error(`Unexpected action: ${action}`);
  });
  const dispose = mountSurface(
    container,
    surface,
    {
      namespace: "repoflow.repositories",
      locale: "zh-CN",
      settings: {},
      threadId: "thread",
      callBackend,
    },
    () => {
      throw new Error("Mount failed");
    },
  );
  const root = container.shadowRoot!;
  const find = (label: string) =>
    Array.from(
      root.querySelectorAll<HTMLButtonElement>(".repo-publication button"),
    ).find((node) => node.textContent === label)!;
  try {
    await rs.waitFor(() => expect(find("已推送到我的 fork")).toBeDefined());
    const push = find("已推送到我的 fork");
    expect(push.disabled).toBe(true);
    expect(push.title).toContain("alice/fork");
    const buttons = root.querySelectorAll<HTMLButtonElement>(
      ".repo-publication button",
    );
    expect(buttons).toHaveLength(6);
    for (const node of buttons) {
      expect(node.textContent).not.toMatch(/…|\.\.\./);
      expect(node.title.length).toBeGreaterThan(12);
    }
    find("保存 PR 信息").click();
    await rs.waitFor(() =>
      expect(
        callBackend.mock.calls.some(
          ([name]) => name === "configure-publication",
        ),
      ).toBe(true),
    );
    await rs.waitFor(() => expect(find("保存 PR 信息").disabled).toBe(false));
    expect(push.disabled).toBe(true);
    find("创建 GitHub 正式 PR").click();
    expect(
      Array.from(
        root.querySelectorAll("dialog dd"),
        (node) => node.textContent,
      ),
    ).toEqual(["upstream/repo", "master", "Reviewed fix"]);
    expect(find("确认创建正式 PR").title).toContain("实际创建 PR");
    find("取消").click();
    expect(find("确认创建正式 PR")).toBeUndefined();
    expect(
      callBackend.mock.calls.some(
        ([name]) => name === "push" || name === "create-pr",
      ),
    ).toBe(false);
  } finally {
    dispose();
  }
});
