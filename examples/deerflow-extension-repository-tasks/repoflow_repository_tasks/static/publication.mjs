import { icon } from "./icons.mjs";

function add(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

export function mountPublicationNotice(root, context) {
  const t = (zh, en) => (context.locale.startsWith("zh") ? zh : en);
  const style = add(root, "link");
  style.rel = "stylesheet";
  style.crossOrigin = "use-credentials";
  style.href = new URL("./styles.css", import.meta.url).href;
  const button = add(root, "button", "", "repo-publication-notice");
  button.type = "button";
  button.title = t(
    "打开发布表单，查看推送状态、填写 PR 信息并选择提交方式。",
    "Open the publication form to check push status, edit PR details and choose how to submit.",
  );
  button.hidden = true;
  let shown;
  let revision = 0;
  async function refresh() {
    const expected = ++revision;
    if (!context.threadId || context.isThreadRunning?.()) return;
    try {
      const data = await context.callBackend("publication", {
        id: context.threadId,
      });
      if (context.signal.aborted || revision !== expected) return;
      const request = data.publication;
      button.hidden = !request;
      if (!request) return;
      button.textContent =
        data.published_commit === data.commit && data.commit
          ? t("已推送 · 查看 PR 表单", "Pushed · View PR form")
          : t("发布请求 · 审阅并确认", "Publication request · Review");
      if (shown !== request.id && request.state === "waiting_for_review") {
        shown = request.id;
        context.openThreadPanel?.("review");
      }
    } catch {
      /* A conversation can exist before a repository is attached. */
    }
  }
  button.onclick = () => context.openThreadPanel?.("review");
  const unsubscribe = context.subscribeThreadActivity?.((running) => {
    if (!running) void refresh();
  });
  void refresh();
  return {
    dispose() {
      revision++;
      unsubscribe?.();
      button.remove();
    },
  };
}

export function mountPublicationForm(
  root,
  context,
  initial,
  call,
  t,
  refresh,
  onUpdate,
) {
  let data = initial;
  let disposed = false;
  let request = 0;
  const alive = () => !disposed && !context.signal.aborted;
  const panel = add(root, "div", null, "repo-publication");
  const status = add(panel, "p", null, "repo-status");
  status.setAttribute("role", "status");
  if (!data.commit) {
    status.textContent = t(
      "请先完成改动并生成审阅提交。",
      "Prepare and review changes first.",
    );
    return {
      dispose() {
        disposed = true;
      },
    };
  }
  const contribution = add(panel, "section", null, "repo-contribution-card");
  const heading = add(contribution, "h3", t("贡献提交", "Contribution commit"));
  heading.prepend(icon("git-commit-horizontal"));
  add(contribution, "p", t("推送仓库：", "Push repository: ") + data.fork);
  add(
    contribution,
    "code",
    data.branch + " · " + data.commit.slice(0, 12),
    "repo-publication-commit",
  );
  if (data.commit_author) {
    const author = add(
      contribution,
      "p",
      t("提交作者：", "Commit author: ") + data.commit_author.name,
      "repo-publication-help",
    );
    author.title = data.commit_author.email;
  }
  const fields = add(panel, "form", null, "repo-fields");
  fields.onsubmit = (event) => event.preventDefault();
  const destination = add(fields, "fieldset", null, "repo-publication-fields");
  add(destination, "legend", t("PR 目标", "PR destination"));
  const target = add(
    add(destination, "label", t("PR 目标仓库", "PR target repository")),
    "select",
  );
  target.setAttribute("aria-label", t("PR 目标仓库", "PR target repository"));
  const upstream = data.upstream_target || data.target;
  for (const repository of new Set([data.fork, upstream])) {
    const option = add(
      target,
      "option",
      repository +
        (repository === data.fork
          ? t("（我的 fork）", " (my fork)")
          : t("（官方 / 上游）", " (official / upstream)")),
    );
    option.value = repository;
  }
  target.value = data.target;
  const base = add(
    add(destination, "label", t("PR 目标分支", "PR base branch")),
    "input",
  );
  base.value = data.base_branch;
  const list = add(fields, "datalist");
  list.id = "branches-" + crypto.randomUUID();
  base.setAttribute("list", list.id);
  const targetDetails = add(
    destination,
    "p",
    data.target + " · " + data.base_branch,
    "repo-target-value",
  );
  const information = add(fields, "fieldset", null, "repo-publication-fields");
  add(information, "legend", t("PR 信息", "PR details"));
  const title = add(
    add(information, "label", t("PR 标题", "PR title")),
    "input",
  );
  title.value = data.title || "";
  title.maxLength = 120;
  const body = add(
    add(information, "label", t("PR 说明", "PR description")),
    "textarea",
  );
  body.rows = 9;
  body.maxLength = 60000;
  body.value = data.pr_body ?? data.report ?? "";
  const preview = add(panel, "details");
  preview.className = "repo-pr-diff-preview";
  add(
    preview,
    "summary",
    t(
      "PR 差异预览（保存目标后更新）",
      "PR diff preview (updated when details are saved)",
    ),
  );
  const diff = add(preview, "pre", data.pr_diff || "", "repo-pr-preview");
  const preparation = add(panel, "section", null, "repo-publication-section");
  add(preparation, "h3", t("保存与推送", "Save and push"));
  const actions = add(preparation, "div", null, "repo-publication-actions");
  add(
    preparation,
    "p",
    t(
      "更新 fork：修改文件后先刷新改动，再推送新提交。仅更正署名时，使用“更正提交署名”。",
      "To update your fork, edit files, refresh changes, then push the new commit. To change attribution only, use Correct commit author.",
    ),
    "repo-publication-help",
  );
  const confirmation = add(panel, "div", null, "repo-publication-confirmation");
  const result = add(panel, "div", null, "repo-publication-result");
  const submission = add(panel, "section", null, "repo-publication-section");
  add(submission, "h3", t("提交到 GitHub", "Submit to GitHub"));
  const creationHint = add(submission, "p", "", "repo-publication-help");
  add(
    submission,
    "p",
    t(
      "草稿 PR 也会在目标仓库真实创建。只想保存在本应用时，请使用“保存 PR 信息”。",
      "A draft PR also creates a real PR in the target repository. To keep a draft in RepoFlow only, use Save PR details.",
    ),
    "repo-publication-help",
  );
  const createActions = add(
    submission,
    "div",
    null,
    "repo-publication-actions",
  );
  const createDialog = add(panel, "dialog", null, "repo-pr-confirmation");
  createDialog.setAttribute(
    "aria-label",
    t("确认提交到 GitHub", "Confirm GitHub submission"),
  );
  let busy = false;
  let options;
  let confirmedSpec;
  let pushButton;
  let authorButton;
  const createButtons = [];
  let finalButton;
  let acknowledgement;
  createDialog.addEventListener("close", () => {
    if (createDialog.open) return;
    createDialog.replaceChildren();
    finalButton = acknowledgement = undefined;
  });
  // Native dialogs live inside the mobile review sheet. Handle Escape before
  // the sheet's document listener so it closes only this confirmation.
  function handleEscape(event) {
    if (
      event.key !== "Escape" ||
      !createDialog.open ||
      !event.composedPath().includes(createDialog)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (!busy) createDialog.close();
  }
  window.addEventListener("keydown", handleEscape, true);
  const isFork = upstream !== data.fork;
  const isPushed = () => data.published_commit === data.commit;
  const spec = () => ({
    commit: data.commit,
    target: target.value,
    base_branch: base.value.trim(),
    title: title.value.trim(),
    body: body.value,
  });
  function button(parent, label, handler, description, primary = false) {
    const wrapper = add(parent, "span", null, "repo-publication-action");
    wrapper.title = description;
    const node = add(wrapper, "button", label, primary ? "repo-primary" : "");
    node.type = "button";
    node.title = description;
    node.onclick = handler;
    return node;
  }
  function syncActions() {
    if (!pushButton) return;
    pushButton.disabled = busy || isPushed();
    pushButton.textContent = isPushed()
      ? isFork
        ? t("已推送到我的 fork", "Pushed to my fork")
        : t("贡献分支已推送", "Contribution branch pushed")
      : isFork
        ? t("推送到我的 fork", "Push to my fork")
        : t("推送贡献分支", "Push contribution branch");
    pushButton.title = isPushed()
      ? t("当前提交已推送到 ", "This commit is already pushed to ") +
        data.fork +
        t(
          "，无需重复推送。文件有新改动时，先刷新改动再推送。",
          ". No repeat push is needed. Refresh changes before pushing new file edits.",
        )
      : t(
          "将当前提交推送到你的贡献仓库 ",
          "Push the reviewed commit to your contribution repository ",
        ) +
        data.fork +
        t(
          "。推送后可向所选目标仓库创建 PR。",
          ". Then create a PR in the selected target repository.",
        );
    pushButton.parentElement.title = pushButton.title;
    const dirty = confirmedSpec !== JSON.stringify(spec());
    const receipt = data.pull_request;
    let reason = dirty
      ? t("请先保存修改后的 PR 信息。", "Save changed PR details first.")
      : !isPushed()
        ? t(
            "请先将当前提交推送到 fork。",
            "Push the current commit to your fork first.",
          )
        : data.pr_status_error
          ? t(
              "无法核实已有 PR 的状态，请刷新改动后重试。",
              "Refresh changes to verify the existing PR status first.",
            )
          : receipt && receipt.state !== "closed"
            ? t(
                "此分支已有打开的 PR。继续推送会更新它，无需再创建。",
                "This branch already has an open PR. Further pushes update it; another PR is unnecessary.",
              )
            : "";
    creationHint.textContent =
      t("目标：", "Target: ") +
      target.value +
      " · " +
      base.value +
      (reason
        ? " — " + reason
        : t(
            "。创建前须勾选确认目标，再点击最终确认。",
            ". Confirm the target checkbox before the final submission.",
          ));
    for (const node of createButtons) {
      node.disabled = busy || Boolean(reason);
      node.title = reason || node.dataset.description;
      node.parentElement.title = node.title;
    }
    if (authorButton) {
      const identity = data.connected_commit_author;
      const correct =
        identity &&
        data.commit_author?.name === identity.name &&
        data.commit_author?.email === identity.email;
      authorButton.disabled = busy || !identity || !isPushed() || correct;
      authorButton.title = !identity
        ? t("先连接你的 GitHub 账号。", "Connect your GitHub account first.")
        : correct
          ? t(
              "当前提交已使用你的 GitHub 身份。",
              "This commit already uses your GitHub identity.",
            )
          : t(
              "用你的 GitHub 身份重新生成相同内容的提交。不会立即推送；之后须单独确认更新 fork。",
              "Regenerate the same content with your GitHub identity. Pushing the replacement to your fork requires separate confirmation.",
            );
      authorButton.parentElement.title = authorButton.title;
    }
    if (finalButton)
      finalButton.disabled = busy || !acknowledgement?.checked || dirty;
  }
  const messages = {
    401: t("请重新登录 RepoFlow。", "Sign in to RepoFlow again."),
    403: t(
      "GitHub 授权或仓库权限不足，请在设置 → 连接中验证。创建 PR 还需要 Pull requests 写权限。",
      "Check GitHub authorization and repository permissions in Settings → Connections. Creating PRs also requires Pull requests write access.",
    ),
    409: t(
      "会话或提交状态已变化，请刷新审阅后重试。",
      "The conversation or commit changed. Refresh the review before retrying.",
    ),
    422: t(
      "请检查标题、目标分支，以及是否存在相同 PR。",
      "Check the title, target branch and existing PRs.",
    ),
  };
  async function perform(operation) {
    if (busy) return;
    busy = true;
    for (const node of panel.querySelectorAll("button,input,select,textarea"))
      node.disabled = true;
    status.textContent = t("正在处理…", "Working…");
    try {
      await operation();
      if (alive()) status.textContent = t("操作完成。", "Done.");
    } catch (error) {
      if (alive())
        status.textContent =
          messages[error?.status] ||
          t(
            "操作结果未确认，请刷新核实后重试；应用不会自动重复提交。",
            "Result unconfirmed. Refresh to reconcile before retrying; this operation is not retried automatically.",
          );
    } finally {
      busy = false;
      if (alive()) {
        for (const node of panel.querySelectorAll(
          "button,input,select,textarea",
        ))
          node.disabled = false;
        syncActions();
      }
    }
  }
  async function save() {
    data = await call("configure-publication", spec());
    if (!alive()) return;
    diff.textContent =
      data.pr_diff ||
      t("所选目标没有差异。", "No differences against the selected target.");
    onUpdate?.(data);
    confirmedSpec = JSON.stringify(spec());
    confirmation.replaceChildren();
    receipts();
    syncActions();
  }
  function invalidate() {
    targetDetails.textContent = target.value + " · " + base.value;
    confirmedSpec = undefined;
    diff.textContent = t(
      "目标或内容已变更，保存后重新计算。",
      "Details changed. Save to recompute the diff.",
    );
    confirmation.replaceChildren();
    createDialog.close?.();
    createDialog.replaceChildren();
    finalButton = acknowledgement = undefined;
    syncActions();
    status.textContent = t(
      "表单已修改，请先保存 PR 信息。",
      "PR details changed. Save them before continuing.",
    );
  }
  for (const field of [target, base, title, body])
    field.addEventListener("input", invalidate);
  function branches() {
    list.replaceChildren();
    const entry = options?.targets?.find(
      (item) => item.repository === target.value,
    );
    for (const name of entry?.branches || []) add(list, "option").value = name;
  }
  target.onchange = () => {
    const entry = options?.targets?.find(
      (item) => item.repository === target.value,
    );
    if (entry?.default_branch) base.value = entry.default_branch;
    branches();
    invalidate();
  };
  if (refresh)
    button(
      actions,
      t("刷新改动", "Refresh changes"),
      () => refresh(),
      t(
        "重新检查文件改动并载入已保存的表单，更新待推送提交。",
        "Check file changes, reload saved PR details and update the reviewed commit.",
      ),
    );
  button(
    actions,
    t("保存 PR 信息", "Save PR details"),
    () => perform(save),
    t(
      "保存标题、完整说明、目标仓库和分支，并更新 PR 差异预览。此按钮不会创建 PR。",
      "Save the title, full description, target and base branch, and update the PR diff. This does not create a PR.",
    ),
  );
  pushButton = button(
    actions,
    isFork
      ? t("推送到我的 fork", "Push to my fork")
      : t("推送贡献分支", "Push contribution branch"),
    () =>
      perform(async () => {
        if (isPushed()) return;
        await save();
        if (!alive()) return;
        confirmation.replaceChildren();
        add(
          confirmation,
          "p",
          t("确认将此提交推送到 ", "Confirm pushing this commit to ") +
            data.fork +
            " · " +
            data.branch +
            " · " +
            data.commit.slice(0, 12),
        );
        add(
          confirmation,
          "p",
          t(
            "这一步只推送贡献分支。创建 PR 将单独确认。",
            "This pushes the contribution branch. PR creation is confirmed separately.",
          ),
        );
        if (data.author_rewrite)
          add(
            confirmation,
            "p",
            t(
              "署名更正将把 fork 分支从 ",
              "Author correction replaces the fork branch commit ",
            ) +
              data.author_rewrite.previous_commit.slice(0, 12) +
              " → " +
              data.commit.slice(0, 12) +
              t(
                "。文件内容不变；远端已有新提交时将拒绝覆盖。",
                ". File contents stay the same. If the remote branch changed, replacement is rejected.",
              ),
          );
        const confirmActions = add(
          confirmation,
          "div",
          null,
          "repo-publication-actions",
        );
        button(
          confirmActions,
          t("取消", "Cancel"),
          () => confirmation.replaceChildren(),
          t(
            "取消本次推送确认，保留已保存的 PR 信息。",
            "Cancel this push confirmation and keep saved PR details.",
          ),
        );
        button(
          confirmActions,
          t("确认推送此提交", "Confirm push"),
          () =>
            perform(async () => {
              if (confirmedSpec !== JSON.stringify(spec()))
                throw new Error("Changed form");
              data = await call("push", {
                commit: data.commit,
                ...(data.author_rewrite
                  ? { replace_commit: data.author_rewrite.previous_commit }
                  : {}),
              });
              if (!alive()) return;
              confirmation.replaceChildren();
              onUpdate?.(data);
              receipts();
            }),
          t(
            "将上述确切提交推送到显示的贡献仓库和分支。",
            "Push this exact commit to the contribution repository and branch shown above.",
          ),
          true,
        );
      }),
    "",
  );
  authorButton = button(
    actions,
    t("更正提交署名", "Correct commit author"),
    () =>
      perform(async () => {
        await call("rewrite-author", { commit: data.commit });
        if (alive()) await refresh?.();
      }),
    t(
      "用当前 GitHub 身份重新生成相同内容的提交，再确认推送到 fork。",
      "Prepare the same content with your GitHub identity, then confirm updating the fork.",
    ),
  );
  function receipts() {
    result.replaceChildren();
    result.dataset.state = isPushed() ? "pushed" : "pending";
    const heading = add(
      result,
      "h3",
      isPushed()
        ? t("Fork 推送成功", "Fork push confirmed")
        : t("Fork 推送状态", "Fork push status"),
    );
    heading.prepend(icon(isPushed() ? "circle-check" : "git-branch"));
    add(
      result,
      "p",
      isPushed()
        ? t("已推送到 ", "Pushed to ") +
            data.fork +
            " · " +
            data.commit.slice(0, 12)
        : t(
            "当前提交尚未推送到 fork。",
            "The current commit has not been pushed to your fork.",
          ),
    );
    const receiptDetails = add(result, "dl", null, "repo-receipt-details");
    for (const [name, value] of [
      [t("仓库", "Repository"), data.fork],
      [t("贡献分支", "Contribution branch"), data.branch],
      [t("提交", "Commit"), data.commit],
    ]) {
      const row = add(receiptDetails, "div");
      add(row, "dt", name);
      add(row, "dd", value);
    }
    if (isPushed() && (data.pr_form_url || data.pr_url)) {
      const link = add(
        result,
        "a",
        data.target === data.fork
          ? t("打开我的仓库 PR 表单 ↗", "Open my repository PR form ↗")
          : t("打开官方仓库 PR 表单 ↗", "Open official repository PR form ↗"),
      );
      link.href = data.pr_form_url || data.pr_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = t(
        "在 GitHub 打开预填表单，仍需在那里自行提交。",
        "Open the prefilled GitHub form; submission there remains a separate action.",
      );
      if (body.value.length > 1400)
        add(
          result,
          "p",
          t(
            "GitHub 链接预填前 1400 个字符；在本应用创建会提交已保存的完整说明。",
            "The GitHub link prefills 1,400 characters. Creating in RepoFlow submits the full saved description.",
          ),
          "repo-publication-help",
        );
    }
    if (data.pull_request) {
      const receipt = data.pull_request;
      const label = receipt.merged
        ? t("PR 已合并 #", "Merged PR #")
        : receipt.state === "closed"
          ? t("PR 已关闭 #", "Closed PR #")
          : receipt.draft
            ? t("已创建草稿 PR #", "Created draft PR #")
            : t("已创建 PR #", "Created PR #");
      const pr = add(result, "a", label + receipt.number);
      pr.href = data.pull_request.url;
      pr.target = "_blank";
      pr.rel = "noopener noreferrer";
      if (receipt.state !== "closed")
        add(
          result,
          "p",
          t(
            "继续推送贡献分支会更新此 PR 的代码。编辑 GitHub 上的标题或说明，请打开现有 PR。",
            "Further pushes to this contribution branch update this PR’s code. Open the existing PR to edit its title or description on GitHub.",
          ),
          "repo-publication-help",
        );
    }
    syncActions();
  }
  for (const draft of [true, false]) {
    const description = draft
      ? t(
          "在 GitHub 目标仓库真实创建草稿 PR；仅本地保存请使用保存 PR 信息。",
          "Create a real draft PR on GitHub. Use Save PR details for local storage only.",
        )
      : t(
          "在 GitHub 目标仓库创建可审查的正式 PR。",
          "Create a regular PR ready for review in the GitHub target repository.",
        );
    const node = button(
      createActions,
      draft
        ? t("创建 GitHub 草稿 PR", "Create draft PR")
        : t("创建 GitHub 正式 PR", "Create PR"),
      () => {
        createDialog.replaceChildren();
        const expected = JSON.stringify(spec());
        const heading = add(
          createDialog,
          "header",
          null,
          "repo-pr-confirmation-heading",
        );
        add(
          heading,
          "h2",
          draft
            ? t("确认创建 GitHub 草稿 PR", "Confirm GitHub draft PR")
            : t("确认创建 GitHub 正式 PR", "Confirm GitHub PR"),
        );
        const content = add(
          createDialog,
          "div",
          null,
          "repo-pr-confirmation-content",
        );
        const details = add(
          content,
          "dl",
          null,
          "repo-pr-confirmation-details",
        );
        for (const [label, value, code] of [
          [t("目标仓库", "Repository"), data.target, true],
          [t("目标分支", "Base branch"), data.base_branch, true],
          [t("PR 标题", "PR title"), data.title, false],
        ]) {
          const row = add(details, "div");
          add(row, "dt", label);
          const description = add(row, "dd");
          add(description, code ? "code" : "span", value);
        }
        add(
          content,
          "p",
          t(
            "这会在目标仓库创建真实 PR，其他有权访问该仓库的人可以看到。",
            "This creates a real PR visible to people who can access the target repository.",
          ),
          "repo-pr-confirmation-note",
        );
        const label = add(
          content,
          "label",
          null,
          "repo-pr-confirmation-acknowledgement",
        );
        acknowledgement = add(label, "input");
        acknowledgement.type = "checkbox";
        add(
          label,
          "span",
          t("我确认向 ", "I confirm creating a PR in ") +
            data.target +
            t(" 创建 ", " as ") +
            (draft
              ? t("GitHub 草稿 PR", "a GitHub draft PR")
              : t("GitHub 正式 PR", "a regular GitHub PR")),
        );
        const confirmActions = add(
          createDialog,
          "footer",
          null,
          "repo-publication-actions repo-pr-confirmation-actions",
        );
        button(
          confirmActions,
          t("取消", "Cancel"),
          () => {
            createDialog.close?.();
            createDialog.replaceChildren();
            finalButton = acknowledgement = undefined;
          },
          t(
            "取消本次创建，不向 GitHub 提交。",
            "Cancel without submitting to GitHub.",
          ),
        );
        finalButton = button(
          confirmActions,
          draft
            ? t("确认创建草稿 PR", "Confirm draft PR")
            : t("确认创建正式 PR", "Confirm PR"),
          () =>
            perform(async () => {
              if (
                !acknowledgement.checked ||
                expected !== confirmedSpec ||
                expected !== JSON.stringify(spec())
              )
                throw new Error("Confirm the saved target");
              data = await call("create-pr", {
                commit: data.commit,
                revision: data.publication_revision,
                draft,
                confirmed: true,
              });
              if (!alive()) return;
              createDialog.close?.();
              createDialog.replaceChildren();
              finalButton = acknowledgement = undefined;
              onUpdate?.(data);
              receipts();
            }),
          t(
            "勾选目标确认后，向显示的仓库实际创建 PR。",
            "After acknowledging the target, submit a real PR to that repository.",
          ),
          true,
        );
        acknowledgement.onchange = syncActions;
        syncActions();
        createDialog.showModal?.();
      },
      description,
      !draft,
    );
    node.dataset.description = description;
    createButtons.push(node);
  }
  confirmedSpec = JSON.stringify(spec());
  receipts();
  syncActions();
  const expected = ++request;
  void call("publication-options")
    .then((data) => {
      if (!alive() || request !== expected) return;
      options = data;
      branches();
    })
    .catch(() => {
      if (alive())
        status.textContent = t(
          "未能读取分支列表，可填写实际分支名后保存验证。",
          "Could not load branches. Enter an existing branch and save to validate.",
        );
    });
  return {
    dispose() {
      disposed = true;
      request++;
      window.removeEventListener("keydown", handleEscape, true);
      createDialog.close?.();
      panel.remove();
    },
  };
}
