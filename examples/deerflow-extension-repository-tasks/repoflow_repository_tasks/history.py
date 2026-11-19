"""Local Git checkpoints after tool operations, separate from published reviews."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import UTC, datetime
from pathlib import Path

from deerflow_extension_api.agent_runs import AgentRunError

from .git_tasks import git

logger = logging.getLogger(__name__)


def workspace(private):
    location = Path((private / "worktrees/repo/gitdir").read_text().strip()).parent
    if not location.is_dir() or location.resolve() != location:
        raise AgentRunError(409, "The conversation workspace needs recovery.")
    return location


def checkpoint(private, base, label):
    location = workspace(private)
    prefix = ("--git-dir", private / "worktrees/repo", "--work-tree", location)
    git(*prefix, "add", "-A", "--", ".")
    tree = git(*prefix, "write-tree").strip()
    try:
        parent = git("--git-dir", private, "rev-parse", "--verify", "refs/repoflow/checkpoints/latest").strip()
    except AgentRunError:
        parent = base
    if git("--git-dir", private, "rev-parse", f"{parent}^{{tree}}").strip() == tree:
        return None
    commit = git("--git-dir", private, "-c", "user.name=RepoFlow", "-c", "user.email=repoflow@users.noreply.github.com", "commit-tree", tree, "-p", parent, "-m", label).strip()
    git("--git-dir", private, "update-ref", "refs/repoflow/checkpoints/latest", commit)
    files = git("--git-dir", private, "diff", "--name-only", "-z", parent, commit, "--").strip("\0").split("\0")
    return {"commit": commit, "parent": parent, "files": files[:200], "file_count": len(files)}


def append(path, entry):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(entry, ensure_ascii=False) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def read(path):
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return []
    records = []
    for line in lines:
        try:
            entry = json.loads(line)
            if isinstance(entry, dict) and isinstance(entry.get("time"), str):
                records.append(entry)
        except ValueError:
            continue
    return records


class GitHistory:
    def __init__(self, tasks, disk, load, save, lock, identifier):
        self.tasks, self.disk, self.load, self.save, self.lock, self.identifier = tasks, disk, load, save, lock, identifier
        self.locks = {}

    async def capture(self, thread, run_id, stage, call_id=""):
        folder = self.tasks.root / self.identifier(thread)
        async with self.locks.setdefault(thread, asyncio.Lock()):
            try:
                async with self.lock(folder):
                    record = await self.disk(self.load, folder / "task.json")
                    if not record or not record.get("base"):
                        return
                    result = await self.disk(checkpoint, folder / "git", record["base"], f"Checkpoint: {stage}"[:180])
                    if result is None:
                        return
                    entry = {**result, "time": datetime.now(UTC).isoformat(), "run_id": run_id, "stage": stage, "call_id": call_id}
                    await self.disk(append, folder / "history.jsonl", entry)
                    record["history_head"] = result["commit"]
                    await self.disk(self.save, folder / "task.json", record)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Repository Git checkpoint failed for thread %s", thread)
                await self.disk(append, folder / "history.jsonl", {"time": datetime.now(UTC).isoformat(), "run_id": run_id, "stage": stage, "error": "Git checkpoint failed; inspect the review before publishing."})

    async def entries(self, folder, page=1):
        if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 10000:
            raise AgentRunError(422, "Choose a valid history page.")
        entries = list(reversed(await self.disk(read, folder / "history.jsonl")))
        return {"entries": entries[(page - 1) * 50 : page * 50], "next_page": page + 1 if len(entries) > page * 50 else None, "total": len(entries)}

    async def diff(self, folder, commit):
        if not isinstance(commit, str) or not re.fullmatch(r"[a-f0-9]{40,64}", commit):
            raise AgentRunError(422, "Choose a valid checkpoint.")
        entries = await self.disk(read, folder / "history.jsonl")
        entry = next((item for item in entries if item.get("commit") == commit), None)
        if entry is None:
            raise AgentRunError(404, "Checkpoint unavailable.")
        patch = await self.disk(git, "--git-dir", folder / "git", "diff", "--no-ext-diff", "--no-textconv", entry["parent"], commit, "--")
        return {"commit": commit, "diff": patch}
