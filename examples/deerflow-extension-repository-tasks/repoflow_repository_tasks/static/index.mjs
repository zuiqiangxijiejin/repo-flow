import { diffFiles } from "./diff.mjs";
import { mountGitHubAccount } from "./account.mjs";
import { mountHistory } from "./history.mjs";
import {
  mountPublicationForm,
  mountPublicationNotice,
} from "./publication.mjs";
import { mountSSHConnections } from "./ssh.mjs";
import { icon } from "./icons.mjs";
import { mountWorkflow } from "./workflow.mjs";

const ATTACHED = "repoflow:repository-attached";
const REPOSITORIES_UPDATED = "repoflow:repositories-updated";

function add(parent, tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function button(parent, text, action, className) {
  const element = add(parent, "button", text, className);
  element.type = "button";
  element.onclick = action;
  return element;
}

function link(parent, text, href) {
  const element = add(parent, "a", text);
  element.href = href;
  element.target = "_blank";
  element.rel = "noopener noreferrer";
  return element;
}

function presentation(root, context) {
  const t = (zh, en) => (context.locale.startsWith("zh") ? zh : en);
  const call = (action, fields = {}, signal) =>
    context.callBackend(
      action,
      {
        id: context.threadId,
        ...fields,
      },
      signal,
    );
  const style = add(root, "link");
  style.rel = "stylesheet";
  style.crossOrigin = "use-credentials";
  style.href = new URL("./styles.css", import.meta.url).href;
  return { t, call };
}

function picker(root, context, t, call, onAttach, newConversation = false) {
  const dialog = add(root, "dialog");
  dialog.setAttribute(
    "aria-label",
    t("关联 GitHub 仓库", "Attach a GitHub repository"),
  );
  add(dialog, "h2", t("关联 GitHub 仓库", "Attach a GitHub repository"));
  const status = add(dialog, "p", null, "repo-status");
  status.setAttribute("role", "status");
  const slot = add(dialog, "div");
  const close = button(dialog, t("关闭", "Close"), () => dialog.close());
  let generation = 0;
  let linkCheck;

  function cancelLinkCheck() {
    linkCheck?.controller.abort();
    linkCheck = undefined;
  }

  dialog.addEventListener("close", () => {
    cancelLinkCheck();
    generation++;
    slot.replaceChildren();
  });
  dialog.addEventListener("cancel", (event) => {
    if (close.disabled) event.preventDefault();
  });

  async function open() {
    if (dialog.open) return;
    dialog.showModal();
    const revision = ++generation;
    const current = () =>
      !context.signal.aborted && dialog.open && generation === revision;
    status.textContent = t("正在读取仓库…", "Loading repositories…");
    close.disabled = false;
    let options;
    try {
      options = newConversation ? [] : await call("repositories");
    } catch {
      if (current())
        status.textContent = t(
          "无法读取仓库列表。",
          "Could not load repositories.",
        );
      return;
    }
    if (!current()) return;
    status.textContent = "";
    const form = add(slot, "form");
    const select = options.length
      ? add(add(form, "label", t("仓库来源", "Repository source")), "select")
      : null;
    if (select) {
      add(select, "option", t("从 GitHub 导入", "Import from GitHub")).value =
        "";
      for (const item of options) {
        add(
          select,
          "option",
          item.base ? item.id + " · " + item.base : item.id,
        ).value = item.id;
      }
    }
    const fields = add(form, "div", null, "repo-fields");
    const remote = add(
      add(fields, "label", t("贡献仓库地址", "Contribution repository URL")),
      "input",
    );
    remote.required = true;
    remote.maxLength = 300;
    remote.placeholder = "https://github.com/owner/repo";
    add(
      fields,
      "small",
      t(
        "可直接使用自己的项目，无需创建 Fork。向其他项目贡献时，选择自己的 Fork。",
        "Use your own project directly without creating a fork. Choose your fork when contributing to another project.",
      ),
      "repo-field-help",
    );
    const upstream = add(
      add(
        fields,
        "label",
        t(
          "PR 目标仓库地址（上游，可选）",
          "PR target repository URL (upstream, optional)",
        ),
      ),
      "input",
    );
    upstream.maxLength = 300;
    upstream.placeholder = "https://github.com/upstream/repo";
    const accountRepositories = add(fields, "div", null, "repo-account-picker");
    fields.insertBefore(accountRepositories, remote.parentElement);
    void call("github-status")
      .then(async (account) => {
        if (!current()) return;
        if (!account.connected) {
          const settings = add(
            accountRepositories,
            "a",
            t(
              "连接 GitHub 账号以选择自己的仓库",
              "Connect GitHub to choose your repositories",
            ),
          );
          settings.href = "/workspace/chats/new?settings=connections";
          return;
        }
        const label = add(
          accountRepositories,
          "label",
          t(
            "选择我的 GitHub 项目（含 Fork，可选）",
            "Choose my GitHub project (including forks, optional)",
          ),
        );
        const repositories = add(label, "select");
        add(
          repositories,
          "option",
          t("选择仓库…", "Select a repository…"),
        ).value = "";
        const result = await call("github-repositories");
        if (!current()) return;
        for (const item of result.repositories) {
          if (item.can_push)
            add(repositories, "option", item.name).value = item.name;
        }
        repositories.onchange = async () => {
          if (!repositories.value) return;
          const name = repositories.value;
          remote.value = "https://github.com/" + name;
          upstream.value = "";
          remote.dispatchEvent(new Event("input"));
          try {
            const details = await call("github-repository", {
              repository: name,
            });
            if (current() && repositories.value === name && details.parent) {
              upstream.value = "https://github.com/" + details.parent;
              upstream.dispatchEvent(new Event("input"));
            }
          } catch {
            /* The addresses remain editable when metadata is unavailable. */
          }
        };
      })
      .catch(() => {});
    add(
      fields,
      "small",
      t(
        "只有向其他项目提 PR 时才填写官方／上游仓库。使用自己的项目时可留空。",
        "Enter an official/upstream repository only for contributions to another project. Leave it blank for your own project.",
      ),
      "repo-field-help",
    );
    const feedback = add(fields, "p", null, "repo-field-check");
    feedback.id = "repo-link-feedback";
    feedback.setAttribute("role", "status");
    for (const input of [remote, upstream])
      input.setAttribute("aria-describedby", feedback.id);
    const messages = {
      "contribution-url": t(
        "上方需要填写完整的 GitHub 仓库地址。",
        "Enter a full GitHub repository URL in the contribution field.",
      ),
      "target-url": t(
        "下方需要填写完整的 GitHub 仓库地址。",
        "Enter a full GitHub repository URL in the PR target field.",
      ),
      "same-repository": t(
        "两个地址相同。直接向上方仓库提 PR 时，将下方留空。",
        "Both addresses are the same. Leave the PR target blank for a PR to the contribution repository.",
      ),
      "contribution-unavailable": t(
        "无法从 GitHub 核验上方仓库。请确认地址，以及仓库是否公开。",
        "GitHub could not verify the contribution repository. Check the address and the repository’s visibility.",
      ),
      "target-unavailable": t(
        "无法从 GitHub 核验下方仓库。请确认地址，以及仓库是否公开。",
        "GitHub could not verify the PR target. Check the address and the repository’s visibility.",
      ),
      "links-reversed": t(
        "两个地址填反了。上方填你的 Fork，下方填上游仓库。",
        "The addresses are reversed. Put your fork above and the upstream repository below.",
      ),
      "not-a-fork": t(
        "填了 PR 目标时，上方需要填写你的 Fork。",
        "Use your fork in the contribution field when providing a PR target.",
      ),
      "different-network": t(
        "上方的 Fork 与下方的 PR 目标不属于同一个 GitHub Fork 网络。",
        "The fork and the PR target belong to different GitHub fork networks.",
      ),
    };
    const unavailable = t(
      "暂时无法通过 GitHub 核验，请稍后重试。",
      "GitHub verification is temporarily unavailable. Try again.",
    );
    const addresses = () => ({
      url: remote.value.trim(),
      upstream_url: upstream.value.trim(),
    });
    let verified;
    function resetCheck() {
      cancelLinkCheck();
      verified = undefined;
      feedback.textContent = "";
      remote.removeAttribute("aria-invalid");
      upstream.removeAttribute("aria-invalid");
    }
    function checkLinks(links) {
      const key = JSON.stringify(links);
      if (verified === key) return Promise.resolve(true);
      if (linkCheck?.key === key) return linkCheck.result;
      cancelLinkCheck();
      const attempt = { key, controller: new AbortController() };
      linkCheck = attempt;
      feedback.textContent = t(
        "正在核对仓库链接…",
        "Checking repository links…",
      );
      attempt.result = (async () => {
        let result;
        try {
          result = await call(
            "validate-links",
            links,
            attempt.controller.signal,
          );
        } catch {
          result = { valid: false, reason: "github-unavailable" };
        }
        if (!current() || linkCheck !== attempt) return false;
        linkCheck = undefined;
        if (result.valid) {
          verified = key;
          remote.removeAttribute("aria-invalid");
          upstream.removeAttribute("aria-invalid");
          feedback.textContent = links.upstream_url
            ? t("Fork 和 PR 目标已匹配。", "The fork matches the PR target.")
            : t(
                "贡献仓库地址格式正确。",
                "The contribution URL format is valid.",
              );
        } else {
          const reason = result.reason;
          feedback.textContent = messages[reason] ?? unavailable;
          if (reason !== "github-unavailable") {
            remote.setAttribute(
              "aria-invalid",
              String(!reason.startsWith("target-")),
            );
            upstream.setAttribute(
              "aria-invalid",
              String(
                !reason.startsWith("contribution-") && reason !== "not-a-fork",
              ),
            );
          }
        }
        return result.valid;
      })();
      return attempt.result;
    }
    for (const input of [remote, upstream]) {
      input.oninput = resetCheck;
      input.onblur = () => {
        const links = addresses();
        if (current() && !select?.value && (links.url || links.upstream_url))
          void checkLinks(links);
      };
    }
    if (select) {
      select.onchange = () => {
        resetCheck();
        fields.hidden = Boolean(select.value);
        remote.required = !select.value;
      };
    }
    const directoryField = add(
      fields,
      "label",
      t("克隆存放目录（可选）", "Clone directory on the server (optional)"),
    );
    const cloneDirectory = add(directoryField, "input");
    cloneDirectory.placeholder = t(
      "留空使用已保存位置或默认目录",
      "Leave blank for the saved or default location",
    );
    cloneDirectory.maxLength = 4096;
    add(
      fields,
      "small",
      t(
        "填写服务器上现有的可写绝对目录，RepoFlow 会在其中创建专属子目录。",
        "Enter an existing writable server directory. RepoFlow creates a dedicated subdirectory.",
      ),
      "repo-field-help",
    );
    const cloneOption = add(form, "label", null, "repo-clone-option");
    const cloneNow = add(cloneOption, "input");
    cloneNow.type = "checkbox";
    add(
      cloneOption,
      "span",
      t("关联后立即克隆并准备对话", "Clone and prepare this conversation now"),
    );
    const threadId = newConversation ? crypto.randomUUID() : context.threadId;
    const submit = add(
      form,
      "button",
      t("关联仓库", "Attach repository"),
      "repo-primary",
    );
    submit.type = "submit";

    form.onsubmit = async (event) => {
      event.preventDefault();
      submit.disabled = true;
      close.disabled = true;
      remote.disabled = true;
      upstream.disabled = true;
      cloneDirectory.disabled = cloneNow.disabled = true;
      if (select) select.disabled = true;
      let repository = select?.value;
      try {
        if (!repository) {
          const links = addresses();
          if (!(await checkLinks(links)) || !current()) return;
          status.textContent = t(
            "正在保存关联…",
            "Saving the repository association…",
          );
          const imported = await call("import", {
            ...links,
            clone_directory: cloneDirectory.value.trim(),
          });
          if (!current()) return;
          repository = imported.id;
          document.dispatchEvent(new Event(REPOSITORIES_UPDATED));
        }
        status.textContent = t(
          "正在关联对话…",
          "Attaching to the conversation…",
        );
        const data = await call("attach", { id: threadId, repository });
        if (!current()) return;
        if (cloneNow.checked) {
          status.textContent = t(
            "正在克隆并准备工作区…",
            "Cloning and preparing the workspace…",
          );
          await call("prepare", { id: threadId });
          if (!current()) return;
        }
        document.dispatchEvent(
          new CustomEvent(ATTACHED, { detail: data.thread }),
        );
        await onAttach(data);
        if (current()) dialog.close();
      } catch {
        if (current())
          status.textContent = repository
            ? t(
                "仓库已保存。工作区未能打开，可以从左栏重试。",
                "Repository saved. Reopen it from the sidebar to retry setting up the workspace.",
              )
            : t(
                "无法导入仓库。请检查仓库地址和访问权限。",
                "Could not import the repository. Check the URLs and access.",
              );
      } finally {
        if (current()) {
          submit.disabled = false;
          close.disabled = false;
          remote.disabled = false;
          upstream.disabled = false;
          cloneDirectory.disabled = cloneNow.disabled = false;
          if (select) select.disabled = false;
        }
      }
    };
    remote.focus();
  }

  return { open, close: () => dialog.close() };
}

function githubRepository(slug) {
  return typeof slug === "string" &&
    /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(slug)
    ? "https://github.com/" + slug
    : null;
}

function observeAttachment(context, call, display) {
  let revision = 0;
  async function load() {
    if (!context.threadId) return;
    const expected = ++revision;
    try {
      const data = await call("current");
      if (!context.signal.aborted && expected === revision) display(data);
    } catch {
      if (!context.signal.aborted && expected === revision) display(undefined);
    }
  }
  document.addEventListener(
    ATTACHED,
    (event) => {
      if (event.detail === context.threadId) void load();
    },
    { signal: context.signal },
  );
  return load;
}

function mountSidebar(root, context) {
  root.classList.add("repo-sidebar-container");
  const { t, call } = presentation(root, context);
  const section = add(root, "div", null, "repo-sidebar");
  section.hidden = true;
  const header = add(section, "header", null, "repo-row");
  const repositoryTitle = add(
    header,
    "strong",
    t("GitHub 仓库", "GitHub repositories"),
  );
  repositoryTitle.prepend(icon("github"));
  const list = add(section, "ul", null, "repo-sidebar-list");
  const status = add(section, "p", null, "repo-status");
  status.setAttribute("role", "status");
  let saved = [];
  let attached;
  let busy = false;
  const attempts = new Map();
  const refreshAttachment = observeAttachment(context, call, (data) => {
    attached = data;
    render();
  });
  const dialog = picker(
    root,
    context,
    t,
    call,
    async (data) => {
      await context.openConversation(data.thread);
    },
    true,
  );
  const addRepository = button(
    header,
    t("+ 添加仓库", "+ Add repository"),
    dialog.open,
    "repo-sidebar-add",
  );
  const tools = add(section, "div", null, "repo-sidebar-tools");
  executionPicker(tools, context, t, call);
  const settings = testSettings(root, context, t, call);
  const configure = button(
    tools,
    t("仓库配置", "Repository settings"),
    settings.open,
    "repo-sidebar-control",
  );
  configure.prepend(icon("settings"));
  configure.title = t(
    "设置该仓库的回归测试命令与工作目录。",
    "Configure this repository’s regression command and working directory.",
  );
  const clones = cloneManager(root, context, t, call);
  const manage = button(
    tools,
    t("克隆管理", "Manage clones"),
    clones.open,
    "repo-sidebar-control",
  );
  manage.prepend(icon("database"));
  manage.title = t(
    "查看并管理此账号保存的仓库克隆。",
    "View and manage repository clones saved for your account.",
  );

  function render() {
    list.replaceChildren();
    for (const repo of saved) {
      const row = add(list, "li", null, "repo-sidebar-card");
      const active = attached?.repository === repo.id;
      if (active) row.dataset.active = "true";
      const forkSlug = repo.fork ?? (active ? attached.fork : null);
      const targetSlug = repo.target ?? (active ? attached.target : null);
      const title = forkSlug ?? repo.id;
      const heading = add(row, "div", null, "repo-sidebar-heading");
      const open = button(
        heading,
        title,
        () => openSaved(repo.id),
        "repo-sidebar-open",
      );
      open.prepend(icon("folder-git-2"));
      open.title = t(
        "用此仓库新建贡献对话",
        "Start a contribution chat for this repository",
      );
      if (active) open.setAttribute("aria-current", "true");
      const remove = button(
        heading,
        t("移除", "Remove"),
        () => removeSaved(repo.id),
        "repo-sidebar-remove",
      );
      remove.setAttribute(
        "aria-label",
        t("从左栏移除 " + repo.id, "Remove " + repo.id + " from the sidebar"),
      );
      open.disabled = remove.disabled = busy;
      const target = githubRepository(targetSlug);
      const fork = githubRepository(forkSlug);
      const reference =
        target && target !== fork
          ? "PR → " + targetSlug + (repo.base ? " · " + repo.base : "")
          : repo.base;
      add(row, "p", reference, "repo-sidebar-target");
      if (target) {
        const links = add(row, "div", null, "repo-links");
        link(links, "Issues ↗", target + "/issues");
        link(links, t("PR ↗", "Pull requests ↗"), target + "/pulls");
      }
    }
  }

  function setBusy(value) {
    busy = value;
    addRepository.disabled = value;
    for (const option of list.querySelectorAll("button"))
      option.disabled = value;
  }

  async function openSaved(repository) {
    if (busy) return;
    setBusy(true);
    status.textContent = t(
      "正在准备贡献工作区…",
      "Preparing the contribution workspace…",
    );
    try {
      const thread = attempts.get(repository) ?? crypto.randomUUID();
      attempts.set(repository, thread);
      const data = await call("attach", { id: thread, repository });
      if (context.signal.aborted) return;
      await context.openConversation(data.thread);
      attempts.delete(repository);
      status.textContent = "";
    } catch {
      if (!context.signal.aborted)
        status.textContent = t(
          "暂时无法打开仓库，请重试。",
          "Could not open the repository. Try again.",
        );
    } finally {
      if (!context.signal.aborted) setBusy(false);
    }
  }

  async function removeSaved(repository) {
    if (busy) return;
    setBusy(true);
    status.textContent = t("正在移除仓库关联…", "Removing repository…");
    try {
      const removed = await call("remove", { repository });
      if (context.signal.aborted) return;
      revision++;
      saved = saved.filter(({ id }) => id !== repository);
      attempts.delete(repository);
      render();
      status.textContent = t("已从左栏移除。", "Removed from the sidebar.");
      if (removed.has_checkout) clones.confirm(repository);
    } catch {
      if (!context.signal.aborted)
        status.textContent = t(
          "移除失败，请重试。",
          "Could not remove the repository. Try again.",
        );
    } finally {
      if (!context.signal.aborted) setBusy(false);
    }
  }

  let revision = 0;
  async function refreshRepositories() {
    const expected = ++revision;
    try {
      const items = await call("repositories");
      if (context.signal.aborted || expected !== revision) return;
      saved = items;
      section.hidden = false;
      render();
    } catch {
      // Keep the last successful list while a refresh is unavailable.
    }
  }
  document.addEventListener(REPOSITORIES_UPDATED, refreshRepositories, {
    signal: context.signal,
  });
  void refreshRepositories();
  void refreshAttachment();
  return {
    dispose: () => {
      dialog.close();
      settings.close();
      clones.close();
    },
  };
}

function cloneManager(root, context, t, call) {
  const dialog = add(root, "dialog");
  const title = add(dialog, "h2");
  const status = add(dialog, "p", null, "repo-status");
  status.setAttribute("role", "status");
  const body = add(dialog, "div", null, "repo-clone-list");
  const close = button(dialog, t("关闭", "Close"), () => dialog.close());
  let version = 0;
  const shown = (expected) =>
    dialog.open && expected === version && !context.signal.aborted;
  dialog.addEventListener("close", () => {
    version++;
  });
  dialog.addEventListener("cancel", (event) => {
    if (close.disabled) event.preventDefault();
  });

  function view(label, closeLabel) {
    title.textContent = label;
    dialog.setAttribute("aria-label", label);
    close.textContent = closeLabel;
    body.replaceChildren();
    status.textContent = "";
    if (!dialog.open) dialog.showModal();
    return ++version;
  }

  async function open() {
    const expected = view(t("克隆管理", "Manage clones"), t("关闭", "Close"));
    status.textContent = t("正在读取克隆副本…", "Loading shared clones…");
    try {
      const existing = await call("clones");
      if (!shown(expected)) return;
      status.textContent = existing.length
        ? ""
        : t("当前没有共享克隆副本。", "There are no shared clones.");
      for (const clone of existing) {
        const row = add(body, "div", null, "repo-clone-entry");
        add(
          row,
          "strong",
          clone.id + (clone.removed ? t(" · 已移除", " · Removed") : ""),
        );
        add(row, "p", clone.path, "repo-clone-path");
        button(row, t("删除副本…", "Delete clone…"), () =>
          confirm(clone.id, open),
        );
      }
    } catch {
      if (shown(expected))
        status.textContent = t(
          "无法读取克隆副本。",
          "Could not load shared clones.",
        );
    }
  }

  function confirm(repository, onDeleted = () => dialog.close()) {
    const expected = view(
      t("删除共享克隆副本？", "Delete the shared clone?"),
      t("以后再删", "Keep for now"),
    );
    add(body, "p", repository);
    add(
      body,
      "p",
      t(
        "各对话已有的代码保留在自己的工作区。再次使用时可重新克隆。",
        "Existing conversation changes stay in their workspaces. The repository can be cloned again.",
      ),
    );
    const remove = button(
      body,
      t("删除副本", "Delete clone"),
      async () => {
        close.disabled = remove.disabled = true;
        try {
          await call("purge-clone", { repository });
          if (shown(expected)) {
            close.disabled = false;
            await onDeleted();
          }
        } catch {
          if (shown(expected))
            status.textContent = t(
              "暂时无法删除副本，请稍后重试。",
              "Could not delete the clone. Try again.",
            );
        } finally {
          close.disabled = remove.disabled = false;
        }
      },
      "repo-primary",
    );
  }
  return { open, confirm, close: () => dialog.close() };
}

function testSettings(root, context, t, call) {
  const dialog = add(root, "dialog");
  dialog.setAttribute("aria-label", t("仓库配置", "Repository settings"));
  add(dialog, "h2", t("仓库配置", "Repository settings"));
  const form = add(dialog, "form");
  const repository = add(add(form, "label", t("仓库", "Repository")), "select");
  const command = add(
    add(form, "label", t("回归测试命令", "Regression command")),
    "input",
  );
  command.placeholder = "npm test";
  command.maxLength = 300;
  const directory = add(
    add(form, "label", t("仓库内目录", "Directory in repository")),
    "input",
  );
  directory.placeholder = t(
    "留空使用仓库根目录",
    "Leave empty for repository root",
  );
  directory.maxLength = 240;
  const status = add(form, "p", null, "repo-status");
  status.setAttribute("role", "status");
  const save = add(
    form,
    "button",
    t("保存配置", "Save settings"),
    "repo-primary",
  );
  save.type = "submit";
  button(dialog, t("关闭", "Close"), () => dialog.close());
  let revision = 0;
  const current = (expected) =>
    dialog.open && !context.signal.aborted && revision === expected;
  const enable = (enabled) => {
    command.disabled = !enabled;
    directory.disabled = !enabled;
    save.disabled = !enabled;
  };
  const load = async () => {
    const expected = ++revision;
    enable(false);
    status.textContent = "";
    try {
      const values = await call("test-settings", {
        repository: repository.value,
      });
      if (!current(expected)) return;
      command.value = values.command;
      directory.value = values.directory;
      enable(true);
    } catch {
      if (current(expected))
        status.textContent = t("无法读取配置。", "Could not load settings.");
    }
  };
  repository.onchange = load;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const expected = ++revision;
    enable(false);
    try {
      await call("save-test-settings", {
        repository: repository.value,
        command: command.value,
        directory: directory.value,
      });
      if (current(expected))
        status.textContent = t("配置已保存。", "Settings saved.");
    } catch {
      if (current(expected))
        status.textContent = t(
          "保存失败，请检查测试命令和仓库内目录。",
          "Could not save. Check the command and directory.",
        );
    } finally {
      if (current(expected)) enable(true);
    }
  };
  async function open() {
    if (dialog.open) return;
    dialog.showModal();
    const expected = ++revision;
    repository.replaceChildren();
    enable(false);
    status.textContent = t("正在读取仓库…", "Loading repositories…");
    try {
      const options = await call("repositories");
      if (!current(expected)) return;
      for (const option of options)
        add(repository, "option", option.id).value = option.id;
      if (!options.length) {
        status.textContent = t("请先添加仓库。", "Add a repository first.");
        return;
      }
      const previous = context.threadId ? await call("current") : null;
      if (!current(expected)) return;
      if (previous) repository.value = previous.repository;
      await load();
    } catch {
      if (current(expected))
        status.textContent = t(
          "无法读取仓库配置。",
          "Could not load repository settings.",
        );
    }
  }
  return { open, close: () => dialog.close() };
}

function executionPicker(parent, context, t, call, showConnections = true) {
  if (showConnections) {
    mountSSHConnections(parent, context, t, call);
    return;
  }
  const position = add(parent, "span", null, "repo-environment");
  position.prepend(icon("monitor"));
  const label = add(position, "span", t("执行位置", "Execution host"));
  position.title = t(
    "在当前 RepoFlow 主机上执行",
    "Runs on the current RepoFlow host",
  );
  call("execution")
    .then((data) => {
      if (context.signal.aborted) return;
      label.textContent = data.ssh_host
        ? t("远程 · ", "SSH · ") + data.ssh_host
        : t("本地执行", "Local");
      position.replaceChildren(
        icon(data.ssh_host ? "terminal" : "monitor"),
        label,
      );
      position.title = data.ssh_host
        ? t("在 SSH 主机上执行", "Runs on this SSH host")
        : t("在当前 RepoFlow 主机上执行", "Runs on the current RepoFlow host");
    })
    .catch(() => {});
}

function mountChatActions(root, context, composer) {
  const { t, call } = presentation(root, context);
  const toolbar = add(root, "div", null, "repo-toolbar");
  toolbar.hidden = true;
  let repository;
  const dialog = picker(root, context, t, call, () => {});
  const repositoryInfo = add(toolbar, "span", null, "repo-context");
  const status = add(toolbar, "span", null, "repo-status");
  status.setAttribute("role", "status");
  const select = button(toolbar, "", async () => {
    if (!repository) return dialog.open();
    if (repository.base) {
      context.openThreadPanel?.("review");
      return;
    }
    select.disabled = true;
    select.textContent = t("正在克隆…", "Cloning…");
    status.textContent = "";
    try {
      await call("prepare");
      if (!context.signal.aborted)
        document.dispatchEvent(
          new CustomEvent(ATTACHED, { detail: context.threadId }),
        );
    } catch {
      if (!context.signal.aborted)
        status.textContent = t(
          "克隆失败，请检查地址和目录后重试。",
          "Could not clone the repository. Check the URL and directory and retry.",
        );
      select.textContent = t("克隆仓库", "Clone repository");
    } finally {
      select.disabled = false;
    }
  });
  if (!composer) executionPicker(toolbar, context, t, call, false);
  const refresh = observeAttachment(context, call, (data) => {
    if (data === undefined) return;
    repository = data;
    repositoryInfo.textContent = data
      ? data.repository + (data.base_branch ? " · " + data.base_branch : "")
      : "";
    repositoryInfo.hidden = composer || !data;
    select.hidden = Boolean(data && !data.base && !composer);
    if (data && !data.base)
      select.textContent = t("克隆仓库", "Clone repository");
    else if (composer && data) select.textContent = t("仓库", "Repository");
    else
      select.textContent = data
        ? t("查看改动", "View changes")
        : t("关联仓库", "Attach repository");
    select.title = data?.repository ?? "";
    toolbar.hidden = false;
  });
  void refresh();
  return { dispose: dialog.close };
}

function mountRegression(root, context) {
  const { t, call } = presentation(root, context);
  const row = add(root, "div", null, "repo-regression-row");
  const status = add(row, "span", null, "repo-prepared-status");
  status.setAttribute("role", "status");
  let repository;
  const run = button(
    row,
    t("运行回归测试", "Run regression tests"),
    async () => {
      if (!repository) return;
      run.disabled = true;
      const selected = repository;
      try {
        const values = await call("test-settings", { repository: selected });
        if (context.signal.aborted || selected !== repository) return;
        let message = t(
          "请运行当前仓库的回归测试，报告实际结果。",
          "Run the repository’s regression tests and report the results.",
        );
        if (values.command)
          message +=
            "\n" + t("测试命令", "Test command") + ": " + values.command;
        if (values.directory)
          message +=
            "\n" +
            t("仓库内目录", "Repository directory") +
            ": " +
            values.directory;
        status.textContent = context.prepareMessage?.(message)
          ? t("点击发送开始测试", "Send to run the tests")
          : t("请先处理当前草稿", "Finish your current draft first");
      } catch {
        if (!context.signal.aborted)
          status.textContent = t(
            "无法读取测试配置",
            "Could not load test settings",
          );
      } finally {
        run.disabled = false;
      }
    },
    "repo-regression",
  );
  row.prepend(run);
  const refresh = observeAttachment(context, call, (data) => {
    repository = data?.repository;
    row.hidden = !repository;
  });
  row.hidden = true;
  void refresh();
  return { dispose: () => row.remove() };
}

function mountReview(root, context) {
  const { t, call } = presentation(root, context);
  root.className = "repo-full-height";
  const panel = add(root, "div", null, "repo-panel");
  const header = add(panel, "header", null, "repo-panel-header repo-row");
  add(header, "h2", t("Git 审阅", "Git review"));
  const close = button(
    header,
    "×",
    () => context.closeThreadPanel?.(),
    "repo-close",
  );
  close.setAttribute("aria-label", t("收起 Git 审阅", "Collapse Git review"));
  close.title = t(
    "收起审阅面板，保留当前对话。",
    "Close the review panel and keep the conversation.",
  );
  const status = add(panel, "p", null, "repo-status");
  status.setAttribute("role", "status");
  const content = add(panel, "div", null, "repo-panel-content");
  const footer = add(panel, "footer", null, "repo-panel-footer");

  let retryTimer;
  let retries = 0;
  let revision = 0;
  let publicationForm;
  async function load() {
    clearTimeout(retryTimer);
    const expected = ++revision;
    publicationForm?.dispose();
    content.replaceChildren();
    footer.replaceChildren();
    footer.hidden = false;
    if (context.isThreadRunning?.()) {
      status.textContent = t(
        "等待 Agent 完成本轮修改，随后自动读取改动…",
        "Waiting for the Agent to finish; changes will refresh automatically…",
      );
      return;
    }
    status.textContent = t("正在读取改动…", "Loading changes…");
    try {
      const data = await call("review");
      if (!context.signal.aborted && revision === expected) {
        retries = 0;
        render(data);
      }
    } catch (error) {
      if (context.signal.aborted || revision !== expected) return;
      status.textContent = t(
        "暂时无法读取改动，请等待当前运行结束后重试。",
        "Changes are unavailable. Retry when the conversation is idle.",
      );
      button(footer, t("重试", "Retry"), load);
      if (error?.status === 409 && retries++ < 15)
        retryTimer = setTimeout(load, 2000);
    }
  }

  function render(data) {
    status.textContent = "";
    content.replaceChildren();
    footer.replaceChildren();

    const workflow = mountWorkflow(content, data, t, (step) =>
      selectTab(step === 0 ? true : "publish"),
    );
    const tabs = add(content, "div", null, "repo-tabs");
    const contextDetails = add(
      content,
      "details",
      null,
      "repo-context-details",
    );
    add(
      contextDetails,
      "summary",
      t("贡献分支与 PR 目标", "Contribution branch and PR target"),
    );
    const branches = add(contextDetails, "dl", null, "repo-branches");
    add(branches, "dt", t("贡献分支", "Contribution branch"));
    add(branches, "dd", data.fork + " · " + data.branch);
    add(branches, "dt", t("PR 目标", "PR target"));
    add(branches, "dd", data.target + " · " + data.base_branch);

    const view = add(content, "div", null, "repo-panel-view");
    const files = diffFiles(data.diff ?? "");
    const changes = button(tabs, t("改动", "Changes"), () => selectTab(true));
    const tests = button(tabs, t("回归测试", "Regression tests"), () =>
      selectTab(false),
    );
    const publication = button(tabs, t("发布 / PR", "Publish / PR"), () =>
      selectTab("publish"),
    );
    const history = button(tabs, t("修改记录", "Change history"), () =>
      selectTab("history"),
    );
    changes.title = t(
      "查看工作区相对于原始基准的文件差异。",
      "View file changes against the original repository baseline.",
    );
    tests.title = t(
      "查看 Agent 最近报告的回归测试结果。",
      "View the latest regression results reported by the Agent.",
    );
    publication.title = t(
      "填写 PR 信息、推送贡献分支，并准备创建 PR。",
      "Edit PR details, push the contribution branch and prepare a PR.",
    );
    history.title = t(
      "查看自动保存的本地 Git 检查点和每次文件差异。",
      "View local Git checkpoints and the file changes at each step.",
    );
    function selectTab(showChanges) {
      publicationForm?.dispose();
      publicationForm = undefined;
      footer.hidden = showChanges === "publish";
      publication.setAttribute(
        "aria-pressed",
        String(showChanges === "publish"),
      );
      history.setAttribute("aria-pressed", String(showChanges === "history"));
      changes.setAttribute("aria-pressed", String(showChanges === true));
      tests.setAttribute("aria-pressed", String(!showChanges));
      view.replaceChildren();
      if (showChanges === "history") {
        publicationForm = mountHistory(view, context, call, t);
        return;
      }
      if (showChanges === "publish") {
        publicationForm = mountPublicationForm(
          view,
          context,
          data,
          call,
          t,
          load,
          (updated) => {
            data = updated;
            workflow.update(data);
            const values = branches.querySelectorAll("dd");
            values[1].textContent = data.target + " · " + data.base_branch;
            const formLink = footer.querySelector("a");
            if (formLink && (data.pr_form_url || data.pr_url))
              formLink.href = data.pr_form_url || data.pr_url;
          },
        );
        return;
      }
      if (!showChanges) {
        if (data.report) {
          const heading = add(view, "h3", t("Agent 报告", "Agent report"));
          heading.prepend(icon("flask-conical"));
          add(view, "pre", data.report, "repo-report");
        } else {
          add(
            view,
            "p",
            t("暂无测试报告。", "No test report is available."),
            "repo-muted",
          );
        }
      } else if (!files.length) {
        add(
          view,
          "p",
          t("工作区没有 Git 差异。", "The workspace has no Git changes."),
          "repo-muted",
        );
      } else {
        const overview = add(view, "dl", null, "repo-change-overview");
        for (const [name, value, kind] of [
          [t("改动文件", "Changed files"), files.length, ""],
          [
            t("新增行数", "Additions"),
            files.reduce((sum, file) => sum + file.added, 0),
            "repo-stat-added",
          ],
          [
            t("删除行数", "Deletions"),
            files.reduce((sum, file) => sum + file.deleted, 0),
            "repo-stat-deleted",
          ],
        ]) {
          const item = add(overview, "div", null, kind);
          add(item, "dt", name);
          add(item, "dd", String(value));
        }
        const list = add(view, "div", null, "repo-file-list");
        const diffDetails = add(view, "details", null, "repo-diff-details");
        diffDetails.open = true;
        const diffName = add(diffDetails, "summary");
        const diff = add(diffDetails, "pre", null, "repo-diff");
        const more = button(
          diffDetails,
          t("显示更多代码", "Show more lines"),
          appendLines,
          "repo-diff-more",
        );
        let selected = 0;
        let rendered = 0;
        function appendLines() {
          const lines = files[selected].lines;
          const end = Math.min(rendered + 200, lines.length);
          const fragment = document.createDocumentFragment();
          for (const line of lines.slice(rendered, end)) {
            const row = add(
              fragment,
              "span",
              null,
              "repo-diff-line " + line.kind,
            );
            const oldLine = add(
              row,
              "span",
              line.oldLine?.toString(),
              "repo-line-number",
            );
            const newLine = add(
              row,
              "span",
              line.newLine?.toString(),
              "repo-line-number",
            );
            oldLine.setAttribute("aria-hidden", "true");
            newLine.setAttribute("aria-hidden", "true");
            add(row, "span", line.text || " ", "repo-line-text");
          }
          diff.append(fragment);
          rendered = end;
          more.hidden = end >= lines.length;
          more.textContent =
            t("显示更多代码", "Show more lines") + ` (${lines.length - end})`;
        }
        function choose(index) {
          Array.from(list.children).forEach((option, item) => {
            option.setAttribute("aria-pressed", String(index === item));
          });
          selected = index;
          rendered = 0;
          diffName.textContent = files[index].name;
          diffDetails.open = true;
          diff.replaceChildren();
          appendLines();
        }
        files.forEach((file, index) => {
          const option = button(list, file.name, () => choose(index));
          const counts = add(option, "span", null, "repo-file-count");
          add(counts, "span", "+" + file.added, "repo-added");
          add(counts, "span", "−" + file.deleted, "repo-deleted");
        });
        choose(0);
      }
    }

    selectTab(
      ["ready_for_confirmation", "pushed", "pr_created"].includes(
        data.publication?.state,
      )
        ? "publish"
        : true,
    );
    if (data.commit) {
      const commit = add(
        footer,
        "div",
        data.title + " · " + data.commit.slice(0, 12),
        "repo-commit",
      );
      commit.title = data.commit;
    }
    const actions = add(footer, "div", null, "repo-row repo-actions");
    button(actions, t("刷新", "Refresh"), load).title = t(
      "重新检查文件改动并更新审阅提交。",
      "Check current file changes and update the reviewed commit.",
    );
    if (data.pr_url?.startsWith("https://github.com/")) {
      link(
        actions,
        t("在 GitHub 打开 PR 表单 ↗", "Open PR form on GitHub ↗"),
        data.pr_url,
      );
    } else if (data.commit) {
      button(
        actions,
        data.fork !== (data.upstream_target || data.target)
          ? t("推送到我的 fork", "Push to my fork")
          : t("推送贡献分支", "Push contribution branch"),
        () => {
          actions.replaceChildren();
          status.textContent = t(
            "确认推送 " +
              data.commit.slice(0, 12) +
              " 到 " +
              data.fork +
              " 的 " +
              data.branch +
              "。",
            "Confirm pushing " +
              data.commit.slice(0, 12) +
              " to " +
              data.fork +
              " on " +
              data.branch +
              ".",
          );
          const back = button(actions, t("返回审阅", "Back to review"), () =>
            render(data),
          );
          back.title = t(
            "取消推送确认，返回文件审阅。",
            "Cancel the push confirmation and return to the review.",
          );
          const confirm = button(
            actions,
            t("推送此提交", "Push this commit"),
            async () => {
              confirm.disabled = true;
              back.disabled = true;
              try {
                const pushed = await call("push", { commit: data.commit });
                if (!context.signal.aborted) render(pushed);
              } catch {
                if (context.signal.aborted) return;
                status.textContent = t(
                  "推送失败。请在设置 → 连接中检查 GitHub 账号和仓库写权限，或刷新 Git 差异。",
                  "Push failed. Check your GitHub account and repository access in Settings → Connections, or refresh the changes.",
                );
                confirm.disabled = false;
                back.disabled = false;
              }
            },
            "repo-primary",
          );
          confirm.title =
            t(
              "将此提交推送到你的贡献仓库 ",
              "Push this commit to your contribution repository ",
            ) + data.fork;
        },
        "repo-primary",
      ).title =
        t(
          "确认后将提交推送到你的贡献仓库 ",
          "After confirmation, push to your contribution repository ",
        ) + data.fork;
    }
  }

  const unsubscribe = context.subscribeThreadActivity?.(() => {
    void load();
  });
  void load();
  return {
    dispose() {
      revision++;
      clearTimeout(retryTimer);
      unsubscribe?.();
      publicationForm?.dispose();
      panel.remove();
    },
  };
}

export default {
  apiVersion: 1,
  module: "repoflow.repositories.v1",
  surfaces: [
    {
      id: "publication-request",
      slot: "thread-toolbar",
      title: "Publication request",
      mount: mountPublicationNotice,
    },
    {
      id: "github-account",
      slot: "settings",
      title: "GitHub account",
      mount: mountGitHubAccount,
    },
    {
      id: "repository-sidebar",
      slot: "workspace-sidebar",
      title: "GitHub repositories",
      mount: mountSidebar,
    },
    {
      id: "repository",
      slot: "thread-toolbar",
      title: "GitHub repository",
      mount: (root, context) => mountChatActions(root, context, false),
    },
    {
      id: "repository-composer",
      slot: "thread-composer",
      title: "Repository and execution host",
      mount: (root, context) => mountChatActions(root, context, true),
    },
    {
      id: "regression",
      slot: "thread-composer",
      title: "Regression tests",
      mount: mountRegression,
    },
    {
      id: "review",
      slot: "thread-panel",
      title: "Git review",
      mount: mountReview,
    },
  ],
};
