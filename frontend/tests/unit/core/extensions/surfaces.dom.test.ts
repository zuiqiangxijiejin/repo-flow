import { expect, rs, test } from "@rstest/core";

import { type SurfaceContext } from "@/core/extensions/contracts";
import { mountSurface } from "@/core/extensions/surfaces";

import repositories from "../../../../../examples/deerflow-extension-repository-tasks/repoflow_repository_tasks/static/index.mjs";

test("opens and removes saved repositories from the sidebar", async () => {
  const surface = repositories.surfaces.find(
    ({ id }) => id === "repository-sidebar",
  );
  if (!surface) throw new Error("Missing repository list");
  const container = document.createElement("div");
  const repository = {
    id: "owner/fork → project/original",
    base: "main",
    fork: "owner/fork",
    target: "project/original",
  };
  let sharedClone = true;
  const callBackend = rs.fn(
    async (action: string, fields: Record<string, unknown>) => {
      if (action === "repositories") return [repository];
      if (action === "execution") return { hosts: [] };
      if (action === "attach") return { thread: fields.id };
      if (action === "current") {
        return {
          repository: repository.id,
          fork: repository.fork,
          target: repository.target,
        };
      }
      if (action === "remove")
        return { id: repository.id, has_checkout: sharedClone };
      if (action === "clones")
        return sharedClone
          ? [{ id: repository.id, path: "/srv/repos/checkout", removed: true }]
          : [];
      if (action === "purge-clone") {
        sharedClone = false;
        return { id: repository.id };
      }
      throw new Error("Unexpected action " + action);
    },
  );
  const navigate = rs.fn(
    async (_id: string, _signal: AbortSignal) => undefined,
  );
  const onError = rs.fn();
  const cleanup = mountSurface(
    container,
    { ...surface, slot: "workspace-sidebar" },
    {
      namespace: "repoflow.repositories",
      locale: "en",
      settings: {},
      threadId: "current-thread",
      callBackend,
      openConversation: navigate,
    },
    onError,
  );
  try {
    const root = container.shadowRoot!;
    const open = () =>
      root.querySelector<HTMLButtonElement>(".repo-sidebar-open");
    await rs.waitFor(() => expect(open()?.textContent).toBe("owner/fork"));
    expect(root.querySelector(".repo-links a")?.getAttribute("href")).toBe(
      "https://github.com/project/original/issues",
    );
    open()?.click();
    await rs.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const [threadId] = navigate.mock.calls[0]!;
    expect(threadId).toMatch(/^[a-f0-9-]{36}$/);
    expect(callBackend).toHaveBeenCalledWith("attach", {
      id: threadId,
      repository: repository.id,
    });
    expect(callBackend.mock.calls.map(([action]) => action)).not.toContain(
      "import",
    );
    await rs.waitFor(() =>
      expect(open()?.getAttribute("aria-current")).toBe("true"),
    );
    root.querySelector<HTMLButtonElement>(".repo-sidebar-remove")?.click();
    await rs.waitFor(() =>
      expect(root.querySelector(".repo-sidebar-card")).toBeNull(),
    );
    expect(callBackend).toHaveBeenCalledWith("remove", {
      id: "current-thread",
      repository: repository.id,
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    const openDialog = () => root.querySelector("dialog[open]");
    await rs.waitFor(() =>
      expect(openDialog()?.getAttribute("aria-label")).toBe(
        "Delete the shared clone?",
      ),
    );
    Array.from(openDialog()!.querySelectorAll("button"))
      .find((item) => item.textContent === "Keep for now")
      ?.click();
    expect(sharedClone).toBe(true);
    Array.from(root.querySelectorAll("button"))
      .find((item) => item.textContent === "Manage clones")
      ?.click();
    await rs.waitFor(() =>
      expect(openDialog()?.textContent).toContain("/srv/repos/checkout"),
    );
    Array.from(openDialog()!.querySelectorAll("button"))
      .find((item) => item.textContent === "Delete clone…")
      ?.click();
    Array.from(openDialog()!.querySelectorAll("button"))
      .find((item) => item.textContent === "Delete clone")
      ?.click();
    await rs.waitFor(() =>
      expect(openDialog()?.textContent).toContain("There are no shared clones"),
    );
    expect(sharedClone).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

test("checks the fork URLs when leaving the field and blocks an invalid import", async () => {
  const surface = repositories.surfaces.find(
    ({ id }) => id === "repository-sidebar",
  );
  if (!surface) throw new Error("Missing repository list");
  const container = document.createElement("div");
  const navigate = rs.fn(async () => undefined);
  const callBackend = rs.fn(
    async (action: string, fields: Record<string, unknown>) => {
      if (action === "repositories") return [];
      if (action === "execution") return { hosts: [] };
      if (action === "validate-links") {
        return fields.url === "https://github.com/owner/fork"
          ? { valid: true }
          : { valid: false, reason: "links-reversed" };
      }
      if (action === "import") return { id: "owner/fork → project/original" };
      if (action === "attach") return { thread: fields.id };
      throw new Error("Unexpected action " + action);
    },
  );
  const cleanup = mountSurface(
    container,
    { ...surface, slot: "workspace-sidebar" },
    {
      namespace: "repoflow.repositories",
      locale: "en",
      settings: {},
      callBackend,
      openConversation: navigate,
    },
    rs.fn(),
  );
  try {
    const root = container.shadowRoot!;
    root.querySelector<HTMLButtonElement>(".repo-sidebar-add")!.click();
    await rs.waitFor(() =>
      expect(root.querySelector(".repo-fields input")).not.toBeNull(),
    );
    const form = root
      .querySelector<HTMLFormElement>(".repo-fields")!
      .closest("form")!;
    const [contribution, target] =
      form.querySelectorAll<HTMLInputElement>(".repo-fields input");
    contribution!.value = "https://github.com/project/original";
    target!.value = "https://github.com/owner/fork";
    target!.dispatchEvent(new Event("blur"));
    const feedback = form.querySelector(".repo-field-check")!;
    await rs.waitFor(() =>
      expect(feedback.textContent).toContain("The addresses are reversed"),
    );
    expect(contribution!.getAttribute("aria-invalid")).toBe("true");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await rs.waitFor(() =>
      expect(form.querySelector("button")?.disabled).toBe(false),
    );
    expect(callBackend.mock.calls.map(([action]) => action)).not.toContain(
      "import",
    );

    contribution!.value = "https://github.com/owner/fork";
    target!.value = "https://github.com/project/original";
    target!.dispatchEvent(new Event("input"));
    target!.dispatchEvent(new Event("blur"));
    await rs.waitFor(() =>
      expect(feedback.textContent).toBe("The fork matches the PR target."),
    );
    expect(contribution!.hasAttribute("aria-invalid")).toBe(false);
    const directory =
      form.querySelectorAll<HTMLInputElement>(".repo-fields input")[2]!;
    directory.value = "/srv/repos";
    expect(
      form.querySelector<HTMLInputElement>('[type="checkbox"]')?.checked,
    ).toBe(false);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await rs.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(callBackend).toHaveBeenCalledWith("import", {
      id: undefined,
      url: "https://github.com/owner/fork",
      upstream_url: "https://github.com/project/original",
      clone_directory: "/srv/repos",
    });
    expect(callBackend.mock.calls.map(([action]) => action)).not.toContain(
      "prepare",
    );
  } finally {
    cleanup();
  }
});

test("repository regression mounts and uses the saved command in a draft", async () => {
  const surface = repositories.surfaces.find(({ id }) => id === "regression");
  if (!surface) throw new Error("Missing regression control");
  const container = document.createElement("div");
  const prepareMessage = rs.fn(() => true);
  const onError = rs.fn();
  const cleanup = mountSurface(
    container,
    { ...surface, slot: "thread-composer" },
    {
      namespace: "repoflow.repositories",
      locale: "en",
      settings: {},
      threadId: "thread-a",
      callBackend: async (action) =>
        action === "current"
          ? { repository: "sample" }
          : { command: "npm test", directory: "frontend" },
      prepareMessage,
    },
    onError,
  );
  try {
    const run =
      container.shadowRoot?.querySelector<HTMLButtonElement>("button");
    expect(run).not.toBeNull();
    await rs.waitFor(() => expect(run?.parentElement?.hidden).toBe(false));
    run?.click();
    await rs.waitFor(() =>
      expect(prepareMessage).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(
          "Test command: npm test\nRepository directory: frontend",
        ),
      ),
    );
    expect(onError).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

test("composer and panel controls stop after a surface is disposed", () => {
  const open = rs.fn();
  const close = rs.fn();
  const prepare = rs.fn(() => true);
  let context!: SurfaceContext;
  const cleanup = mountSurface(
    document.createElement("div"),
    {
      id: "review",
      title: "Review",
      slot: "thread-panel",
      mount(_root, mounted) {
        context = mounted;
        return { dispose: rs.fn() };
      },
    },
    {
      namespace: "community.example",
      locale: "en",
      settings: {},
      callBackend: rs.fn(),
      openThreadPanel: open,
      closeThreadPanel: close,
      prepareMessage: prepare,
    },
    rs.fn(),
  );
  context.openThreadPanel?.("review");
  expect(context.prepareMessage?.("Run tests")).toBe(true);
  context.closeThreadPanel?.();
  cleanup();
  expect(() => context.openThreadPanel?.("review")).toThrow();
  expect(() => context.closeThreadPanel?.()).toThrow();
  expect(context.prepareMessage?.("Replace draft")).toBe(false);
  expect(open).toHaveBeenCalledExactlyOnceWith("review");
  expect(close).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledExactlyOnceWith("Run tests");
});

test("surface cleanup aborts outstanding work and rejects late backend calls", async () => {
  const container = document.createElement("div");
  const dispose = rs.fn();
  const backend = rs.fn(async () => ({}));
  let callLater: (
    name: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown> = rs.fn();
  let signal: AbortSignal | undefined;
  const cleanup = mountSurface(
    container,
    {
      id: "picker",
      slot: "page",
      title: "Picker",
      mount(root, context) {
        signal = context.signal;
        callLater = context.callBackend;
        root.textContent = "PLUGIN UI";
        return { dispose };
      },
    },
    {
      namespace: "community.example",
      locale: "en",
      settings: {},
      threadId: "a",
      callBackend: backend,
    },
    rs.fn(),
  );
  expect(container.shadowRoot?.textContent).toBe("PLUGIN UI");
  await callLater("search", {});
  cleanup();
  cleanup();
  await expect(callLater("search", {})).rejects.toThrow();
  expect(backend).toHaveBeenCalledTimes(1);
  expect(signal?.aborted).toBe(true);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(container.shadowRoot?.textContent).toBe("");
});

test("a failed mount is isolated and cannot leave its partial UI behind", () => {
  const error = rs.fn();
  const container = document.createElement("div");
  mountSurface(
    container,
    {
      id: "bad",
      slot: "page",
      title: "Broken",
      mount(root) {
        root.textContent = "partial";
        throw new Error("broken");
      },
    },
    {
      namespace: "community.example",
      locale: "en",
      settings: {},
      callBackend: rs.fn(),
    },
    error,
  );
  expect(error).toHaveBeenCalledTimes(1);
  expect(container.shadowRoot?.textContent).toBe("");
});

for (const failMount of [false, true]) {
  test(`surface ${failMount ? "mount failure" : "cleanup"} aborts navigation and rejects stale callbacks`, async () => {
    let openLater!: (id: string) => Promise<void>;
    let pending!: Promise<void>;
    let finish!: () => void;
    const navigate = rs.fn();
    const open = rs.fn(async (_id: string, signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      signal.throwIfAborted();
      navigate();
    });
    const cleanup = mountSurface(
      document.createElement("div"),
      {
        id: "library",
        slot: "page",
        title: "Library",
        mount(_root, context) {
          openLater = context.openConversation!;
          pending = openLater("thread");
          if (failMount) throw new Error("mount failed");
          return { dispose: rs.fn() };
        },
      },
      {
        namespace: "bookmarks",
        locale: "en",
        settings: {},
        callBackend: rs.fn(),
        openConversation: open,
      },
      rs.fn(),
    );
    if (!failMount) cleanup();
    finish();
    await expect(pending).rejects.toThrow();
    await expect(openLater("thread")).rejects.toThrow();
    expect(open).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });
}
