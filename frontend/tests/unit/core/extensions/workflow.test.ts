import { expect, test } from "@rstest/core";

import { workflowState } from "../../../../../examples/deerflow-extension-repository-tasks/repoflow_repository_tasks/static/workflow.mjs";

const base = { target: "upstream/repo", commit: "reviewed" };
test("Git milestones require the exact published commit and a receipt for this target", () => {
  expect(workflowState({})).toEqual(["active", "pending", "pending"]);
  expect(workflowState(base)).toEqual(["complete", "active", "pending"]);
  expect(workflowState({ ...base, published_commit: "older" })).toEqual([
    "complete",
    "active",
    "pending",
  ]);
  expect(workflowState({ ...base, published_commit: "reviewed" })).toEqual([
    "complete",
    "complete",
    "active",
  ]);
  expect(
    workflowState({
      ...base,
      published_commit: "reviewed",
      pull_request: { repository: "other/repo", state: "open" },
    }),
  ).toEqual(["complete", "complete", "active"]);
});

test("Git milestones distinguish drafts, open, closed, merged and unverified receipts", () => {
  const data = {
    ...base,
    published_commit: "reviewed",
    pull_request: { repository: "upstream/repo", state: "open", draft: true },
  };
  expect(workflowState(data)[2]).toBe("draft");
  expect(
    workflowState({
      ...data,
      pull_request: { ...data.pull_request, draft: false },
    })[2],
  ).toBe("open");
  expect(
    workflowState({
      ...data,
      pull_request: { ...data.pull_request, state: "closed" },
    })[2],
  ).toBe("closed");
  expect(
    workflowState({
      ...data,
      pull_request: { ...data.pull_request, state: "closed", merged: true },
    })[2],
  ).toBe("merged");
  expect(workflowState({ ...data, pr_status_error: true })[2]).toBe("active");
  expect(workflowState({ ...data, commit: "new-change" })[2]).toBe("pending");
});
