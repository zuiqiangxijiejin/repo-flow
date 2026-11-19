import { icon } from "./icons.mjs";

export function workflowState(data) {
  const reviewed = Boolean(data.commit);
  const pushed = reviewed && data.commit === data.published_commit;
  const receipt = data.pull_request;
  const matching =
    receipt &&
    (receipt.repository === data.target ||
      receipt.url ===
        `https://github.com/${data.target}/pull/${receipt.number}`);
  const known = matching && !data.pr_status_error;
  return [
    reviewed ? "complete" : "active",
    pushed ? "complete" : reviewed ? "active" : "pending",
    known && pushed
      ? receipt.merged
        ? "merged"
        : receipt.state === "closed"
          ? "closed"
          : receipt.draft
            ? "draft"
            : "open"
      : pushed
        ? "active"
        : "pending",
  ];
}

export function mountWorkflow(parent, data, t, onSelect) {
  const list = document.createElement("ol");
  list.className = "repo-workflow";
  list.setAttribute("aria-label", t("Git 工作流", "Git workflow"));
  parent.append(list);
  function update(record) {
    list.replaceChildren();
    const names = [
      t("检查改动", "Review changes"),
      t("推送 Fork", "Push fork"),
      t("创建 PR", "Create pull request"),
    ];
    const states = workflowState(record);
    const captions = {
      complete: t("已完成", "Complete"),
      active: t("待处理", "Next"),
      pending: t("待前序步骤完成", "Waiting"),
      draft: t("草稿 PR 已创建", "Draft PR created"),
      open: t("PR 待审阅", "PR open for review"),
      closed: t("PR 已关闭", "PR closed"),
      merged: t("PR 已合并", "PR merged"),
    };
    names.forEach((name, index) => {
      const item = document.createElement("li");
      item.dataset.state = states[index];
      const button = document.createElement("button");
      button.type = "button";
      button.title = name + " · " + captions[states[index]];
      if (states[index] === "active")
        button.setAttribute("aria-current", "step");
      const badge = document.createElement("span");
      badge.className = "repo-workflow-number";
      if (["complete", "draft", "open", "merged"].includes(states[index]))
        badge.append(icon("check"));
      else badge.textContent = String(index + 1);
      const title = document.createElement("strong");
      title.textContent = name;
      const caption = document.createElement("small");
      caption.textContent = captions[states[index]];
      button.append(badge, title, caption);
      button.onclick = () => onSelect(index);
      item.append(button);
      list.append(item);
    });
  }
  update(data);
  return { update };
}
