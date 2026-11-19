import { expect, rs, test } from "@rstest/core";

import { mountSSHConnections } from "../../../../../examples/deerflow-extension-repository-tasks/repoflow_repository_tasks/static/ssh.mjs";

test("empty SSH entry opens a host form, requires fingerprint trust and never returns secrets", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const abort = new AbortController();
  let profile: Record<string, unknown> | undefined;
  const call = rs.fn(
    async (action: string, fields: Record<string, unknown>) => {
      if (action === "execution")
        return {
          hosts: profile ? ["host-id"] : [],
          profiles: profile ? [profile] : [],
        };
      if (action === "ssh-probe")
        return { host_keys: "offline-key", fingerprints: ["SHA256:fixture"] };
      if (action === "ssh-save") {
        expect(fields.secret).toBe("offline-password");
        expect(fields.trust_host).toBe(true);
        const publicFields = { ...fields };
        delete publicFields.secret;
        delete publicFields.host_keys;
        delete publicFields.trust_host;
        profile = { ...publicFields, id: "host-id" };
        return profile;
      }
      if (action === "ssh-test") return { connected: true };
      throw new Error(action);
    },
  );
  mountSSHConnections(
    root,
    { signal: abort.signal },
    (_zh: string, en: string) => en,
    call,
  );
  const button = (text: string) =>
    Array.from(root.querySelectorAll("button")).find(
      (node) => node.textContent === text,
    )!;
  const field = (text: string) =>
    Array.from(root.querySelectorAll("label"))
      .find((node) => node.firstChild?.textContent === text)!
      .querySelector<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input,select,textarea")!;
  try {
    button("SSH connections").click();
    await rs.waitFor(() => expect(root.textContent).toContain("No hosts yet"));
    expect(root.querySelector("dialog")!.open).toBe(true);
    field("Host name").value = "My host";
    field("Host address").value = "dev.example.test";
    field("SSH username").value = "alice";
    field("Authentication").value = "password";
    field("Authentication").dispatchEvent(new Event("change"));
    field("SSH password").value = "offline-password";
    expect(button("Save host").disabled).toBe(true);
    button("Read host fingerprint").click();
    await rs.waitFor(() =>
      expect(root.textContent).toContain("SHA256:fixture"),
    );
    expect(button("Save host").disabled).toBe(true);
    const trust = root.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    trust.checked = true;
    trust.dispatchEvent(new Event("change"));
    button("Save host").click();
    await rs.waitFor(() => expect(button("Test SSH connection")).toBeDefined());
    expect(field("SSH password").value).toBe("");
    button("Test SSH connection").click();
    await rs.waitFor(() =>
      expect(root.textContent).toContain(
        "SSH authentication and host fingerprint verified",
      ),
    );
    expect(call).toHaveBeenCalledWith("ssh-test", { id: "host-id" });
    expect(button("Connect remote app").disabled).toBe(true);
    button("Edit").click();
    expect(field("Host address").value).toBe("dev.example.test");
    expect(field("SSH password").value).toBe("");
    field("SSH password").value = "discard-on-close";
    button("Close").click();
    await rs.waitFor(() => expect(field("SSH password").value).toBe(""));
    expect(root.textContent).not.toContain("offline-password");
  } finally {
    abort.abort();
    root.remove();
  }
});
