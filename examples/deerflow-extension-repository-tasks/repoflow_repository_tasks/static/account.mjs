function element(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

export function mountGitHubAccount(root, context) {
  const t = (zh, en) => context.locale.startsWith("zh") ? zh : en;
  const style = element(root, "link");
  style.rel = "stylesheet";
  style.crossOrigin = "use-credentials";
  style.href = new URL("./styles.css", import.meta.url).href;
  const panel = element(root, "div", null, "repo-account");
  element(panel, "h2", "GitHub");
  element(panel, "p", t("连接自己的 GitHub 账号，用于访问仓库和推送贡献分支。", "Connect your GitHub account to access repositories and push contribution branches."), "repo-muted");
  const status = element(panel, "p", null, "repo-status");
  status.setAttribute("role", "status");
  const content = element(panel, "div");
  let timer;
  let busy = false;
  let current;
  let revision = 0;
  const alive = () => !context.signal.aborted;

  function action(parent, label, handler, className) {
    const button = element(parent, "button", label, className);
    button.type = "button";
    button.disabled = busy;
    button.onclick = handler;
    return button;
  }

  async function run(name, payload = {}) {
    if (busy) return;
    busy = true;
    const requestRevision = ++revision;
    clearTimeout(timer);
    status.textContent = t("正在处理…", "Working…");
    for (const button of content.querySelectorAll("button")) button.disabled = true;
    try {
      const data = await context.callBackend(name, payload);
      if (!alive() || revision !== requestRevision) return;
      busy = false;
      if (name === "github-check") {
        status.textContent = t("GitHub 连接验证通过。", "GitHub connection verified.");
        render(current);
      } else {
        status.textContent = "";
        render(data);
      }
    } catch {
      if (!alive() || revision !== requestRevision) return;
      busy = false;
      status.textContent = t("操作未完成，请检查 GitHub 授权后重试。", "The operation could not complete. Check your GitHub authorization and retry.");
      if (current) render(current);
      else action(content, t("重试", "Retry"), () => run("github-status"));
    }
  }

  function render(data) {
    current = data;
    clearTimeout(timer);
    content.replaceChildren();
    if (data.connected && data.account) {
      const profile = element(content, "div", null, "repo-account-profile");
      element(profile, "strong", "@" + data.account.login);
      element(profile, "span", t("已连接", "Connected"), "repo-muted");
      const actions = element(content, "div", null, "repo-row");
      action(actions, t("验证连接", "Verify connection"), () => run("github-check"));
      action(actions, t("断开连接", "Disconnect"), () => run("github-disconnect"));
      const access = element(content, "details");
      element(access, "summary", t("查看可访问的仓库", "View accessible repositories"));
      const list = element(access, "div", null, "repo-account-repositories");
      let page = 1;
      let loading = false;
      const load = async () => {
        if (loading || page === null) return;
        loading = true;
        more.disabled = true;
        try {
          const result = await context.callBackend("github-repositories", { page });
          if (!alive() || !access.isConnected) return;
          for (const repo of result.repositories) {
            const row = element(list, "div", null, "repo-account-repository");
            element(row, "span", repo.name);
            element(row, "small", repo.can_push ? t("可推送", "Write access") : t("只读", "Read only"), "repo-muted");
          }
          page = result.next_page;
          more.hidden = page === null;
          if (!list.children.length) element(list, "p", t("当前授权没有可列出的仓库。", "No repositories are available with this authorization."));
        } catch {
          if (alive()) status.textContent = t("无法读取仓库，请检查授权后重试。", "Could not load repositories. Check authorization and retry.");
        } finally {
          loading = false;
          more.disabled = false;
        }
      };
      const more = action(access, t("加载仓库", "Load repositories"), load);
      access.addEventListener("toggle", () => { if (access.open && !list.children.length) void load(); });
      element(content, "p", t("断开连接会删除 RepoFlow 保存的凭据。你也可以在 GitHub 的应用设置中撤销授权。", "Disconnecting removes the credentials saved in RepoFlow. You can also revoke authorization in GitHub application settings."), "repo-muted");
    }

    const authorization = data.authorization;
    if (authorization && ["starting", "pending"].includes(authorization.state)) {
      const box = element(content, "div", null, "repo-account-device");
      if (authorization.code) {
        element(box, "p", t("在 GitHub 输入此验证码完成授权", "Enter this code on GitHub to authorize the connection"));
        element(box, "code", authorization.code);
        const open = element(box, "a", t("前往 GitHub 授权 ↗", "Authorize on GitHub ↗"));
        open.href = "https://github.com/login/device";
        open.target = "_blank";
        open.rel = "noopener noreferrer";
      } else {
        element(box, "p", t("正在获取 GitHub 验证码…", "Requesting a GitHub authorization code…"));
      }
      action(box, t("取消授权", "Cancel authorization"), () => run("github-cancel"));
      const pollRevision = revision;
      timer = setTimeout(async () => {
        try {
          const result = await context.callBackend("github-status", {});
          if (alive() && pollRevision === revision) render(result);
        } catch {
          if (alive() && pollRevision === revision) status.textContent = t("授权状态读取失败，请刷新重试。", "Could not refresh authorization status. Reload and retry.");
        }
      }, 2000);
      return;
    }
    if (authorization?.state === "failed") element(content, "p", t("浏览器授权未完成或已过期，请重新连接。", "Browser authorization failed or expired. Please connect again."), "repo-status");
    if (data.connected) return;
    if (data.browser_available) action(content, t("连接 GitHub", "Connect GitHub"), () => run("github-login"), "repo-primary");
    const details = element(content, "details");
    details.open = !data.browser_available;
    element(details, "summary", t("使用访问令牌连接", "Connect with an access token"));
    const form = element(details, "form", null, "repo-fields");
    const label = element(form, "label", "GitHub Token");
    const input = element(label, "input");
    input.type = "password";
    input.autocomplete = "off";
    input.required = true;
    input.maxLength = 4096;
    input.placeholder = "github_pat_…";
    element(form, "small", t("选择自己的仓库，并授予 Contents 和 Pull requests 读写权限。", "Select your repositories and grant Contents and Pull requests read and write access."), "repo-muted");
    const tokens = element(form, "a", t("在 GitHub 创建令牌 ↗", "Create a token on GitHub ↗"));
    tokens.href = "https://github.com/settings/personal-access-tokens/new";
    tokens.target = "_blank";
    tokens.rel = "noopener noreferrer";
    const submit = element(form, "button", t("验证并连接", "Verify and connect"), "repo-primary");
    submit.type = "submit";
    form.onsubmit = (event) => {
      event.preventDefault();
      const token = input.value.trim();
      input.value = "";
      void run("github-token", { token });
    };
  }

  void run("github-status");
  return { dispose() { revision++; clearTimeout(timer); panel.remove(); } };
}
