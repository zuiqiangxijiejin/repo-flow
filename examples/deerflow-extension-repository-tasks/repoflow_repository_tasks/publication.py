"""Owner-scoped publication requests and independently confirmed GitHub PRs."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from functools import partial
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from uuid import uuid4

from deerflow_extension_api.agent_runs import AgentRunError
from deerflow_extension_api.plugins import ModelTool

from .git_tasks import compare_url, git


class Publications:
    def __init__(self, tasks, disk, load, save, lock, identifier):
        self.tasks, self.disk, self.load, self.save, self.lock, self.identifier = tasks, disk, load, save, lock, identifier

    def folder(self, thread):
        try:
            return self.tasks.root / self.identifier(thread)
        except (ValueError, TypeError):
            raise AgentRunError(422, "Open an attached repository conversation.") from None

    async def record(self, thread, owner):
        folder = self.folder(thread)
        record = await self.disk(self.load, folder / "task.json")
        if not record or record["owner"] != owner:
            raise AgentRunError(404, "Repository conversation unavailable.")
        return folder, record

    async def specification(self, payload, record):
        title = payload.get("title", record.get("title", ""))
        body = payload.get("body", record.get("pr_body", ""))
        target = payload.get("target", record.get("target", record["fork"]))
        upstream = record.get("upstream_target", record["target"])
        target = record["fork"] if target == "fork" else upstream if target == "upstream" else target
        if target not in {record["fork"], upstream}:
            raise AgentRunError(422, "Choose your contribution repository or its registered upstream.")
        base = payload.get("base_branch", record["base_branch"])
        if not isinstance(title, str) or not title.strip() or len(title) > 120 or any(ord(c) < 32 for c in title):
            raise AgentRunError(422, "Enter a PR title of 1 to 120 characters.")
        if not isinstance(body, str) or len(body) > 60000:
            raise AgentRunError(422, "Enter a PR description of up to 60000 characters.")
        if not isinstance(base, str) or not base or len(base) > 200:
            raise AgentRunError(422, "Choose a valid target branch.")
        await self.disk(git, "check-ref-format", f"refs/heads/{base}")
        return {"title": title.strip(), "body": body, "target": target, "base_branch": base}

    async def tool(self, name, payload, context):
        if not context.principal.user_id or not context.thread_id:
            raise AgentRunError(403, "An authenticated conversation is required.")
        folder, record = await self.record(context.thread_id, context.principal.user_id)
        if name == "publication_status":
            return self.public(record)
        if name in {"repository_changes", "repository_baseline"}:
            return await self.disk(self.inspect, folder / "git", record["base"], payload.get("path"))
        if not context.run_id:
            raise AgentRunError(403, "A host-bound run is required.")
        async with self.lock(folder):
            _, record = await self.record(context.thread_id, context.principal.user_id)
            spec = await self.specification(payload, record)
            previous = record.get("publication", {})
            if previous.get("run_id") != context.run_id or previous.get("spec") != spec:
                record["publication"] = {"id": uuid4().hex, "run_id": context.run_id, "state": "waiting_for_review", "spec": spec}
                await self.disk(self.save, folder / "task.json", record)
        return {
            **self.public(record),
            "next_step": ("The application prepares review after this run. Open View changes to confirm the exact commit and push. This request has not pushed or created a PR. Do not run sandbox git or export patches."),
        }

    @staticmethod
    def public(record):
        result = {k: record.get(k) for k in ("thread", "fork", "target", "base_branch", "branch", "commit", "published_commit", "pr_form_url", "pull_request", "history_head")}
        request = record.get("publication")
        result["publication"] = {k: request[k] for k in ("id", "run_id", "state")} if request else None
        return result

    def tools(self):
        async def status(payload, context):
            return await self.tool("publication_status", payload, context)

        async def prepare(payload, context):
            return await self.tool("prepare_publication", payload, context)

        async def changes(payload, context):
            return await self.tool("repository_changes", payload, context)

        async def baseline(payload, context):
            return await self.tool("repository_baseline", payload, context)

        spec = {
            "type": "object",
            "properties": {
                "title": {"type": "string", "minLength": 1, "maxLength": 120},
                "body": {"type": "string", "maxLength": 60000},
                "target": {"type": "string", "enum": ["fork", "upstream"]},
                "base_branch": {"type": "string", "maxLength": 200},
            },
            "required": ["title", "body", "target"],
            "additionalProperties": False,
        }
        return (
            ModelTool(
                "repository_changes",
                "Read the host Git working-tree status and tracked diff against this conversation's baseline. Use this to identify extra changes; no sandbox .git or GitHub network is needed. Read-only, includes untracked file names.",
                {"type": "object", "properties": {}, "additionalProperties": False},
                changes,
            ),
            ModelTool(
                "repository_baseline",
                "Read a text file from this conversation's original Git baseline, for exact comparison or restoring unintended changes yourself. Use this instead of fetching upstream copies or searching the filesystem. Read-only.",
                {"type": "object", "properties": {"path": {"type": "string", "minLength": 1, "maxLength": 240}}, "required": ["path"], "additionalProperties": False},
                baseline,
            ),
            ModelTool(
                "publication_status",
                "Read this conversation's actual host Git publication status. No sandbox Git access is needed. Never claim a push or PR succeeded without a receipt.",
                {"type": "object", "properties": {}, "additionalProperties": False},
                status,
            ),
            ModelTool(
                "prepare_publication",
                (
                    "Prepare host Git review and PR form when asked to commit, push, or prepare a PR. "
                    "target=fork means a PR inside the user's fork; upstream means the official repository. "
                    "Queues review after your run, without pushing or creating a PR. Direct the user to the confirmation."
                ),
                spec,
                prepare,
            ),
        )

    @staticmethod
    def inspect(private, base, path):
        if path is not None:
            if not isinstance(path, str) or not path or len(path) > 240:
                raise AgentRunError(422, "Enter a repository-relative file path.")
            parsed = PurePosixPath(path)
            if parsed.is_absolute() or any(part in ("..", ".git") for part in parsed.parts) or "\\" in path or any(ord(c) < 32 for c in path):
                raise AgentRunError(422, "Enter a repository-relative file path.")
            content = git("--git-dir", private, "show", f"{base}:{parsed}")
            if "\0" in content:
                raise AgentRunError(422, "This baseline file is not text.")
            return {"path": str(parsed), "base_commit": base, "content": content[:20000], "truncated": len(content) > 20000}
        # Git created this private pointer when the host prepared the worktree.
        # The sandbox cannot modify it; no host path is returned to the model.
        marker = private / "worktrees" / "repo" / "gitdir"
        workspace = Path(marker.read_text().strip()).parent
        if not workspace.is_dir() or workspace.resolve() != workspace:
            raise AgentRunError(409, "The conversation workspace needs recovery.")
        prefix = ("--no-optional-locks", "--git-dir", private / "worktrees" / "repo", "--work-tree", workspace)
        status = git(*prefix, "status", "--porcelain=v1", "--untracked-files=all")
        diff = git(*prefix, "diff", "--no-ext-diff", "--no-textconv", base, "--")
        return {"base_commit": base, "status": status[:12000], "tracked_diff": diff[:20000], "truncated": len(status) > 12000 or len(diff) > 20000}

    async def options(self, record):
        upstream = record.get("upstream_target", record["target"])
        targets = []
        for slug in dict.fromkeys([record["fork"], upstream]):
            credentials = await self.tasks.accounts.credentials(record["owner"])
            if not credentials:
                raise AgentRunError(409, "Connect your GitHub account in Settings → Connections.")
            metadata = await self.tasks.accounts.repository(record["owner"], slug, credentials=credentials)
            branches = await self.tasks.accounts._api(credentials["token"], f"/repos/{slug}/branches", {"per_page": 100})
            targets.append({"repository": slug, "default_branch": metadata.get("default_branch"), "branches": [b["name"] for b in branches if isinstance(b, dict) and isinstance(b.get("name"), str)]})
        return {"targets": targets}

    async def configure(self, payload, record):
        if not record.get("commit") or payload.get("commit") != record["commit"]:
            raise AgentRunError(409, "Refresh and review the current commit.")
        spec = await self.specification(payload, record)
        credentials = await self.tasks.accounts.credentials(record["owner"])
        if not credentials:
            raise AgentRunError(409, "Connect your GitHub account in Settings → Connections.")
        await self.tasks.accounts.repository(record["owner"], spec["target"], credentials=credentials)
        branch = await self.tasks.accounts._api(credentials["token"], f"/repos/{spec['target']}/branches/{quote(spec['base_branch'], safe='')}")
        base_commit = (branch.get("commit") or {}).get("sha", "") if isinstance(branch, dict) else ""
        if not isinstance(base_commit, str) or not re.fullmatch(r"[a-f0-9]{40,64}", base_commit):
            raise AgentRunError(502, "GitHub returned an invalid target commit.")
        record["pr_diff"] = await self.disk(partial(self.compare, self.folder(record["thread"]) / "git", spec, base_commit, record["commit"], credentials["token"]))
        record["pr_base_commit"] = base_commit
        record.setdefault("upstream_target", record["target"])
        if record.get("pull_request") and (record["target"], record["base_branch"]) != (spec["target"], spec["base_branch"]):
            record["previous_pull_request"] = record.pop("pull_request")
            record.pop("pr_status_error", None)
        record.update(title=spec["title"], pr_body=spec["body"], target=spec["target"], base_branch=spec["base_branch"])
        record["publication_revision"] = uuid4().hex
        if record.get("published_commit") == record["commit"]:
            record["pr_form_url"] = compare_url(record["target"], record["fork"], record["base_branch"], record["branch"], record["title"], record["pr_body"])
            record["pr_url"] = record["pr_form_url"]  # Compatibility with older browser packages.
        return record

    async def refresh_receipt(self, record):
        receipt = record.get("pull_request")
        if not receipt:
            record.pop("pr_status_error", None)
            return
        repository = next((slug for slug in {record["fork"], record["target"], record.get("upstream_target")} if slug and receipt.get("url") == f"https://github.com/{slug}/pull/{receipt.get('number')}"), None)
        if repository is None:
            record["pr_status_error"] = True
            return
        try:
            credentials = await self.tasks.accounts.credentials(record["owner"])
            if credentials is None:
                raise AgentRunError(409, "Connect GitHub to refresh PR status.")
            result = await self.tasks.accounts._api(credentials["token"], f"/repos/{repository}/pulls/{receipt['number']}")
            if not isinstance(result, dict) or result.get("state") not in {"open", "closed"}:
                raise AgentRunError(502, "GitHub returned an invalid PR status.")
            receipt.update(state=result["state"], draft=bool(result.get("draft")), merged=bool(result.get("merged")), repository=repository)
            record.pop("pr_status_error", None)
        except AgentRunError:
            record["pr_status_error"] = True

    @staticmethod
    def compare(private, spec, base, commit, token):
        try:
            git("--git-dir", private, "cat-file", "-e", f"{base}^{{commit}}")
        except AgentRunError:
            git("--git-dir", private, "fetch", "--no-tags", "--", f"https://github.com/{spec['target']}.git", f"refs/heads/{spec['base_branch']}", network=True, token=token)
        # GitHub PRs compare from the merge base, including unpublished local commits.
        return git("--git-dir", private, "diff", "--no-ext-diff", "--no-textconv", f"{base}...{commit}", "--")

    async def create_pr(self, payload, folder, record):
        if payload.get("confirmed") is not True or not isinstance(payload.get("draft"), bool):
            raise AgentRunError(422, "Explicitly confirm the PR target and whether to create a GitHub draft or regular PR.")
        if payload.get("commit") != record.get("commit") or not record.get("commit") or record.get("published_commit") != record["commit"]:
            raise AgentRunError(409, "Push the exact reviewed commit before creating a PR.")
        if not record.get("publication_revision") or payload.get("revision") != record["publication_revision"]:
            raise AgentRunError(409, "Review the PR target, title and description before confirming.")
        if record.get("pull_request") and record["pull_request"].get("state", "open") == "open":
            return
        draft = payload["draft"]
        credentials = await self.tasks.accounts.credentials(record["owner"])
        if not credentials:
            raise AgentRunError(409, "Reconnect your GitHub account.")
        head_state = await self.tasks.accounts._api(credentials["token"], f"/repos/{record['fork']}/branches/{quote(record['branch'], safe='')}")
        if not isinstance(head_state, dict) or (head_state.get("commit") or {}).get("sha") != record["commit"]:
            raise AgentRunError(409, "The remote contribution branch changed. Review and push the intended commit again.")
        owner = record["fork"].split("/", 1)[0]
        head = f"{owner}:{record['branch']}"
        path = f"/repos/{record['target']}/pulls"
        # Reconcile before retrying: the preceding request may have succeeded remotely.
        existing = await self.tasks.accounts._api(credentials["token"], path, {"head": head, "base": record["base_branch"], "state": "open"})
        if existing:
            result = existing[0]
        else:
            record["pr_creation"] = "submitting"
            record["pr_creation_confirmation"] = {
                "time": datetime.now(UTC).isoformat(),
                "commit": record["commit"],
                "target": record["target"],
                "base_branch": record["base_branch"],
                "draft": draft,
                "revision": record["publication_revision"],
            }
            await self.disk(self.save, folder / "task.json", record)
            result = await self.tasks.accounts._api(credentials["token"], path, method="POST", body={"title": record["title"], "body": record.get("pr_body", ""), "head": head, "base": record["base_branch"], "draft": draft})
        number = result.get("number") if isinstance(result, dict) else None
        if not isinstance(number, int) or number < 1:
            raise AgentRunError(502, "GitHub returned an invalid pull request receipt.")
        record["pull_request"] = {
            "number": number,
            "url": f"https://github.com/{record['target']}/pull/{number}",
            "draft": bool(result.get("draft")),
            "state": result.get("state", "open"),
            "merged": bool(result.get("merged")),
            "repository": record["target"],
        }
        record["pr_creation"] = "created"
        if record.get("publication"):
            record["publication"]["state"] = "pr_created"
        await self.disk(self.save, folder / "task.json", record)
