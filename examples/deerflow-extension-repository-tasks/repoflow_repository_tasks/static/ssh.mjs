import { icon } from "./icons.mjs";

export function mountSSHConnections(parent, context, t, call) {
  const add = (root, tag, text, cls) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (cls) node.className = cls;
    root.append(node);
    return node;
  };
  const button = (root, text, handler, help = text) => {
    const node = add(root, "button", text);
    node.type = "button";
    node.onclick = handler;
    node.title = help;
    return node;
  };
  const dialog = add(parent, "dialog");
  dialog.setAttribute(
    "aria-label",
    t("SSH 主机配置", "SSH host configuration"),
  );
  add(dialog, "h2", t("SSH 主机配置", "SSH host configuration"));
  add(
    dialog,
    "p",
    t(
      "配置仅保存到你的账号。连接用于启动已安装的远程 RepoFlow，再打开远程应用。",
      "Profiles belong to your account. Connect starts an installed remote RepoFlow service and opens its app.",
    ),
    "repo-field-help",
  );
  const status = add(dialog, "p", "", "repo-status");
  status.setAttribute("role", "status");
  const list = add(dialog, "div", "", "repo-ssh-list");
  const form = add(dialog, "form", "", "repo-ssh-form");
  add(form, "h3", t("添加或编辑主机", "Add or edit a host"));
  const field = (label, type = "text", value = "") => {
    const node = add(add(form, "label", label), "input");
    node.type = type;
    node.value = value;
    return node;
  };
  const name = field(t("主机名称", "Host name"));
  name.required = true;
  name.maxLength = 80;
  const address = field(t("主机地址", "Host address"));
  address.required = true;
  address.placeholder = "server.example.com";
  const port = field(t("SSH 端口", "SSH port"), "number", "22");
  port.min = 1;
  port.max = 65535;
  const username = field(t("SSH 用户名", "SSH username"));
  username.required = true;
  const auth = add(
    add(form, "label", t("认证方式", "Authentication")),
    "select",
  );
  auth.setAttribute("aria-label", t("认证方式", "Authentication"));
  for (const [value, label] of [
    ["key", t("SSH 私钥", "SSH private key")],
    ["password", t("密码", "Password")],
  ]) {
    const option = add(auth, "option", label);
    option.value = value;
  }
  const keyLabel = add(
    form,
    "label",
    t("SSH 私钥（无口令）", "SSH private key (without passphrase)"),
  );
  const key = add(keyLabel, "textarea");
  key.rows = 5;
  key.autocomplete = "off";
  key.spellcheck = false;
  const password = field(t("SSH 密码", "SSH password"), "password");
  password.autocomplete = "new-password";
  const origin = field(t("远程 RepoFlow 地址", "Remote RepoFlow URL"));
  origin.placeholder = "https://repoflow.example.com";
  add(
    form,
    "p",
    t(
      "仅保存主机或测试 SSH 时可留空。启动远程应用需要该主机已安装 RepoFlow，并填写访问地址。",
      "Optional for saving a host or testing SSH. Starting the remote app requires RepoFlow installed there and its browser URL.",
    ),
    "repo-field-help",
  );
  const service = field(
    t("远程服务名称", "Remote service name"),
    "text",
    "repoflow.target",
  );
  const readyPort = field(
    t("远程 RepoFlow 端口", "Remote RepoFlow port"),
    "number",
    "12026",
  );
  readyPort.min = 1;
  readyPort.max = 65535;
  const fingerprints = add(form, "pre", "", "repo-report");
  fingerprints.hidden = true;
  const trustLabel = add(form, "label", "", "repo-clone-option");
  trustLabel.hidden = true;
  const trust = add(trustLabel, "input");
  trust.type = "checkbox";
  add(
    trustLabel,
    "span",
    t("我已核对并信任此主机指纹", "I verified and trust this host fingerprint"),
  );
  const actions = add(form, "div", "", "repo-publication-actions");
  let busy = false,
    editing,
    probe,
    revision = 0;
  const alive = () => !context.signal.aborted && dialog.open;
  const values = () => ({
    name: name.value.trim(),
    address: address.value.trim(),
    port: Number(port.value),
    username: username.value.trim(),
    auth_type: auth.value,
    origin: origin.value.trim(),
    service: service.value.trim(),
    ready_port: Number(readyPort.value),
  });
  function resetProbe() {
    probe = undefined;
    trust.checked = false;
    trustLabel.hidden = fingerprints.hidden = true;
    sync();
  }
  function sync() {
    for (const node of dialog.querySelectorAll("[data-unavailable]"))
      node.disabled = true;
    password.parentElement.hidden = auth.value !== "password";
    keyLabel.hidden = auth.value !== "key";
    const same =
      editing &&
      editing.address === address.value.trim() &&
      editing.port === Number(port.value);
    save.disabled = busy || (!same && !(probe && trust.checked));
  }
  function clear() {
    editing = undefined;
    form.reset();
    port.value = "22";
    readyPort.value = "12026";
    service.value = "repoflow.target";
    key.value = password.value = "";
    resetProbe();
  }
  async function perform(operation) {
    if (busy) return;
    busy = true;
    for (const node of dialog.querySelectorAll("button,input,select,textarea"))
      node.disabled = true;
    status.textContent = t("正在处理…", "Working…");
    try {
      await operation();
    } catch {
      if (alive())
        status.textContent = t(
          "操作失败。请检查地址、指纹、凭据及远程服务配置。",
          "Operation failed. Check the address, fingerprint, credentials and remote service.",
        );
    } finally {
      busy = false;
      if (alive()) {
        for (const node of dialog.querySelectorAll(
          "button,input,select,textarea",
        ))
          node.disabled = false;
        sync();
      }
    }
  }
  button(
    actions,
    t("读取主机指纹", "Read host fingerprint"),
    () =>
      perform(async () => {
        probe = await call("ssh-probe", values());
        if (!alive()) return;
        fingerprints.textContent = probe.fingerprints.join("\n");
        fingerprints.hidden = trustLabel.hidden = false;
        trust.checked = false;
        status.textContent = t(
          "请与服务器控制台提供的指纹核对后勾选信任。",
          "Compare this fingerprint with your server console before trusting it.",
        );
      }),
    t(
      "只读取 SSH 主机公钥指纹，不发送密码或私钥。",
      "Read the SSH host fingerprint without sending your password or private key.",
    ),
  );
  const save = button(
    actions,
    t("保存主机", "Save host"),
    () => form.requestSubmit(),
    t(
      "加密保存此账号的主机与凭据，随后可以测试连接。",
      "Save this account’s host and encrypted credentials, then test the connection.",
    ),
  );
  button(
    actions,
    t("新建配置", "New profile"),
    clear,
    t("清空表单，添加另一台主机。", "Clear the form to add another host."),
  );
  form.onsubmit = (event) => {
    event.preventDefault();
    void perform(async () => {
      const secret = auth.value === "key" ? key.value : password.value;
      await call("ssh-save", {
        ...values(),
        ...(editing ? { id: editing.id } : {}),
        ...(secret ? { secret } : {}),
        ...(probe
          ? { host_keys: probe.host_keys, trust_host: trust.checked }
          : {}),
      });
      if (!alive()) return;
      clear();
      await load();
      status.textContent = t(
        "主机已加密保存，可以测试连接。",
        "Host saved with encrypted credentials. You can now test it.",
      );
    });
  };
  address.oninput = port.oninput = resetProbe;
  auth.onchange = sync;
  trust.onchange = sync;
  async function connect(host) {
    await perform(async () => {
      const result = await call("connect", { host });
      if (!alive()) return;
      const url = new URL(result.origin);
      if (url.hostname === location.hostname) {
        status.textContent = t(
          "远程应用需要独立的访问域名。",
          "The remote app needs a distinct access hostname.",
        );
        return;
      }
      status.textContent = t(
        "远程 RepoFlow 已就绪。",
        "Remote RepoFlow is ready.",
      );
      const link = add(
        status,
        "a",
        t("打开远程 RepoFlow", "Open remote RepoFlow"),
      );
      link.href = new URL("/workspace/chats/new", url).href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
  }
  async function load() {
    const expected = ++revision;
    const data = await call("execution");
    if (!alive() || expected !== revision) return;
    list.replaceChildren();
    if (!data.hosts.length)
      add(
        list,
        "p",
        t("尚未配置主机，请在下方添加。", "No hosts yet. Add one below."),
        "repo-field-help",
      );
    for (const host of data.hosts) {
      const profile = data.profiles?.find((item) => item.id === host);
      const row = add(list, "div", "", "repo-clone-entry");
      add(row, "strong", profile ? profile.name : host);
      if (profile)
        add(
          row,
          "p",
          `${profile.username}@${profile.address}:${profile.port}`,
          "repo-clone-path",
        );
      const controls = add(row, "div", "", "repo-publication-actions");
      const connectButton = button(
        controls,
        t("连接远程应用", "Connect remote app"),
        () => connect(host),
        t(
          "通过 SSH 启动该主机已安装的 RepoFlow 服务。",
          "Start the installed RepoFlow service over SSH.",
        ),
      );
      if (profile && !profile.origin) {
        connectButton.disabled = true;
        connectButton.dataset.unavailable = "true";
        connectButton.title = t(
          "编辑主机并填写远程 RepoFlow 地址后，可启动远程应用。",
          "Edit this host and add its remote RepoFlow URL to start the app.",
        );
      }
      if (!profile) continue;
      button(
        controls,
        t("测试 SSH 连接", "Test SSH connection"),
        () =>
          perform(async () => {
            await call("ssh-test", { id: host });
            if (alive())
              status.textContent = t(
                "SSH 认证与主机指纹验证通过。",
                "SSH authentication and host fingerprint verified.",
              );
          }),
        t(
          "验证 SSH 连接，不启动远程应用。",
          "Verify SSH access without starting the remote app.",
        ),
      );
      button(controls, t("编辑", "Edit"), () => {
        editing = profile;
        name.value = profile.name;
        address.value = profile.address;
        port.value = profile.port;
        username.value = profile.username;
        auth.value = profile.auth_type;
        origin.value = profile.origin || "";
        service.value = profile.service;
        readyPort.value = profile.ready_port;
        key.value = password.value = "";
        key.placeholder = password.placeholder = t(
          "留空保留现有凭据",
          "Leave blank to keep the saved credential",
        );
        resetProbe();
        form.scrollIntoView?.({ block: "nearest" });
      });
      button(
        controls,
        t("删除", "Delete"),
        () =>
          perform(async () => {
            await call("ssh-delete", { id: host });
            if (alive()) {
              if (editing?.id === host) clear();
              await load();
              status.textContent = t(
                "主机配置已删除。",
                "Host profile deleted.",
              );
            }
          }),
        t(
          "仅删除此账号保存的主机和凭据，不删除服务器上的文件。",
          "Remove this account’s host and credential without deleting remote files.",
        ),
      );
    }
  }
  button(dialog, t("关闭", "Close"), () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    revision++;
    clear();
    status.textContent = "";
  });
  context.signal.addEventListener(
    "abort",
    () => {
      revision++;
      key.value = password.value = "";
      dialog.close();
      dialog.remove();
    },
    { once: true },
  );
  const opener = button(
    parent,
    t("SSH 连接", "SSH connections"),
    async () => {
      dialog.showModal();
      sync();
      try {
        await load();
      } catch {
        status.textContent = t(
          "无法读取主机，可关闭后重试。",
          "Could not load hosts. Close and retry.",
        );
      }
    },
    t(
      "添加、编辑并测试你自己的 SSH 主机配置。",
      "Add, edit and test your own SSH host profiles.",
    ),
  );
  opener.className = "repo-sidebar-control";
  opener.prepend(icon("terminal"));
  sync();
}
