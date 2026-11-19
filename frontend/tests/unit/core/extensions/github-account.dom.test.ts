import { expect, rs, test } from "@rstest/core";

import { type PluginSurface } from "@/core/extensions/contracts";
import { mountSurface } from "@/core/extensions/surfaces";

import repositories from "../../../../../examples/deerflow-extension-repository-tasks/repoflow_repository_tasks/static/index.mjs";

const accountSurface = repositories.surfaces.find(
  ({ id }) => id === "github-account",
)! as PluginSurface;

test("personal token is cleared and the connected account can be disconnected", async () => {
  const container = document.createElement("div");
  const disconnected = {
    connected: false,
    browser_available: false,
    authorization: null,
  };
  const callBackend = rs.fn(async (name: string) => {
    if (name === "github-token")
      return {
        connected: true,
        account: { login: "alice" },
        browser_available: false,
      };
    return disconnected;
  });
  const dispose = mountSurface(
    container,
    accountSurface,
    {
      namespace: "repoflow.repositories",
      locale: "en",
      settings: {},
      callBackend,
    },
    () => {
      throw new Error("Mount failed");
    },
  );
  try {
    const root = container.shadowRoot!;
    await rs.waitFor(() => expect(root.querySelector("input")).toBeTruthy());
    const input = root.querySelector<HTMLInputElement>("input")!;
    input.value = "github_pat_private_test_token";
    root
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    expect(input.value).toBe("");
    await rs.waitFor(() => expect(root.textContent).toContain("@alice"));
    expect(callBackend).toHaveBeenCalledWith("github-token", {
      token: "github_pat_private_test_token",
    });
    expect(root.textContent).not.toContain("github_pat_private_test_token");
    const disconnect = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Disconnect",
    )!;
    disconnect.click();
    await rs.waitFor(() => expect(root.textContent).not.toContain("@alice"));
    expect(callBackend).toHaveBeenCalledWith("github-disconnect", {});
  } finally {
    dispose();
    container.remove();
  }
});

test("browser authorization displays the device code and can be cancelled", async () => {
  const container = document.createElement("div");
  const disconnected = { connected: false, browser_available: true };
  const callBackend = rs.fn(async (action: string) => {
    if (action === "github-login")
      return {
        ...disconnected,
        authorization: { state: "pending", code: "ABCD-1234" },
      };
    return disconnected;
  });
  const dispose = mountSurface(
    container,
    accountSurface,
    {
      namespace: "repoflow.repositories",
      locale: "en",
      settings: {},
      callBackend,
    },
    () => {
      throw new Error("Mount failed");
    },
  );
  try {
    const root = container.shadowRoot!;
    await rs.waitFor(() => expect(root.querySelector("button")).toBeTruthy());
    root.querySelector<HTMLButtonElement>("button")!.click();
    await rs.waitFor(() => expect(root.textContent).toContain("ABCD-1234"));
    expect(root.querySelector<HTMLAnchorElement>("a")?.href).toBe(
      "https://github.com/login/device",
    );
    root.querySelector<HTMLButtonElement>("button")!.click();
    await rs.waitFor(() => expect(root.textContent).not.toContain("ABCD-1234"));
    expect(callBackend).toHaveBeenCalledWith("github-cancel", {});
  } finally {
    dispose();
    container.remove();
  }
});
