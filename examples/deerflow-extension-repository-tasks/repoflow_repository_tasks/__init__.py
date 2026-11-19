"""RepoFlow repository tasks built on the native DeerFlow run lifecycle."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path, PurePosixPath
from uuid import UUID

from deerflow_extension_api import extension
from deerflow_extension_api.agent_runs import AgentRunError
from deerflow_extension_api.contracts import TaskLifecycleContributor
from deerflow_extension_api.plugins import (
    BackendAction,
    BrowserAssets,
    PluginContribution,
)

from .accounts import GitHubAccounts
from .agent_context import AttachedRepository
from .execution import Execution
from .git_tasks import (
    Repository,
    capture,
    clone_repository,
    compare_url,
    git,
    github_slug,
    prepare,
    publish,
)
from .github import RepositoryLinkError, repository_urls, validate_fork
from .history import GitHistory
from .publication import Publications
from .ssh_hosts import SSHHosts

NAMESPACE = "repoflow.repositories"


async def disk(fn, *args):
    task = asyncio.create_task(asyncio.to_thread(fn, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        await asyncio.gather(task, return_exceptions=True)
        raise


def identifier(value):
    if not isinstance(value, str) or str(UUID(value)) != value:
        raise ValueError("Invalid task ID")
    return value


def load(path):
    return json.loads(path.read_text()) if path.is_file() else None


def save(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    staged = path.with_suffix(".tmp")
    staged.write_text(json.dumps(value, ensure_ascii=False))
    staged.chmod(0o600)
    staged.replace(path)


def repository_key(value):
    return hashlib.sha256(value.encode()).hexdigest()


@asynccontextmanager
async def task_lock(path):
    # The task record and Git snapshot are single-host files, under an operator-owned root.
    import fcntl

    def acquire():
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        handle = (path / "lock").open("a")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            handle.close()
            raise AgentRunError(409, "Another request is updating this task.") from exc
        return handle

    handle = await disk(acquire)
    try:
        yield
    finally:
        handle.close()


class Tasks(TaskLifecycleContributor):
    def __init__(self, config):
        self.execution = Execution(config.get("execution", {}))
        self.root = Path(config["storage_path"])
        if not self.root.is_absolute() or self.root.is_symlink():
            raise ValueError("Repository tasks require a local absolute storage path")
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.accounts = GitHubAccounts(self.root, disk)
        self.ssh = SSHHosts(self.root, self.accounts._cipher)
        self.publications = Publications(self, disk, load, save, task_lock, identifier)
        self.history = GitHistory(self, disk, load, save, task_lock, identifier)
        self.repositories = {
            key: Repository(
                Path(repo["path"]),
                repo["branch"],
                repo.get("push_remote", "origin"),
                repo.get("upstream_remote"),
            )
            for key, repo in config.get("repositories", {}).items()
        }

    async def on_task_start(self, app_store, task_store, info):
        try:
            thread = identifier(info.thread_id)
        except ValueError:
            return
        record = await disk(load, self.root / thread / "task.json")
        if record and record.get("base"):

            async def checkpoint(stage, call_id=""):
                await self.history.capture(thread, info.run_id, stage, call_id)

            task_store.set(AttachedRepository(checkpoint))
            await checkpoint("turn_start")

    async def on_task_stop(self, app_store, task_store, info, outcome):
        attached = task_store.get(AttachedRepository)
        if attached and attached.checkpoint:
            await attached.checkpoint("turn_end")

    def imports_for(self, user_id):
        user_key = hashlib.sha256(user_id.encode()).hexdigest()
        return self.root / "imports" / user_key

    def available(self, user_id):
        imported = {}
        for metadata_path in self.imports_for(user_id).glob("checkouts/*/repository.json"):
            spec = load(metadata_path)
            if spec:
                imported[spec["id"]] = Repository(
                    self.checkout_path(metadata_path.parent, spec),
                    spec.get("branch"),
                    "origin",
                    "upstream" if spec["upstream"] else None,
                )
        return {**imported, **self.repositories}

    def selectable(self, user_id):
        removed = self.imports_for(user_id) / "removed"
        return {key: repo for key, repo in self.available(user_id).items() if not (removed / repository_key(key)).is_file()}

    def repository_list(self, user_id):
        items = []
        for key, repo in sorted(self.selectable(user_id).items(), key=lambda entry: entry[0].casefold()):
            item = {"id": key, "base": repo.branch}
            try:
                _, fork, target = self.registration(user_id, key, repo)
            except (AgentRunError, ValueError):
                # Keep a saved entry visible when its checkout needs attention.
                pass
            else:
                item.update(fork=fork, target=target)
            items.append(item)
        return items

    def conversation_branches(self, thread_ids, owner):
        result = {}
        for raw in thread_ids:
            try:
                thread_id = identifier(raw)
            except (TypeError, ValueError):
                continue
            record = load(self.root / thread_id / "task.json")
            if record and record["owner"] == owner:
                result[thread_id] = {
                    "repository": record["repository"],
                    "branch": record["branch"],
                }
        return result

    @staticmethod
    def import_urls(entry, registration):
        if "url" in registration:
            return registration["url"], registration.get("upstream_url")
        checkout = entry / "checkout"
        origin = git("-C", checkout, "remote", "get-url", "origin").strip()
        upstream = git("-C", checkout, "remote", "get-url", "upstream").strip() if registration["upstream"] else None
        return origin, upstream

    def registration(self, user_id, repo_id, repo):
        if repo_id in self.repositories:
            return repo.registration()
        entry = self.imports_for(user_id) / "checkouts" / repository_key(repo_id)
        metadata = load(entry / "repository.json")
        if not metadata or metadata["id"] != repo_id:
            raise AgentRunError(404, "Repository registration unavailable.")
        origin, upstream = self.import_urls(entry, metadata)
        fork = github_slug(origin)
        return origin, fork, github_slug(upstream) if upstream else fork

    @staticmethod
    def checkout_path(entry, metadata):
        parent = metadata.get("clone_directory")
        if parent:
            return Path(parent) / ".repoflow-clones" / entry.parents[1].name / entry.name / "checkout"
        return entry / "checkout"

    def owned_checkout(self, entry, metadata, *, create=False):
        checkout = self.checkout_path(entry, metadata)
        folder = checkout.parent
        if entry.resolve() != entry or folder.resolve() != folder or checkout.resolve() != checkout:
            raise AgentRunError(409, "Unexpected clone storage path.")
        if metadata.get("clone_directory"):
            marker = folder / "repoflow.json"
            expected = {"registration": str(entry)}
            if create and not folder.exists():
                folder.mkdir(mode=0o700, parents=True, exist_ok=False)
                save(marker, expected)
            if folder.exists() and (marker.is_symlink() or load(marker) != expected):
                raise AgentRunError(409, "Clone directory is already in use.")
        return checkout

    def save_registration(self, entry, repo_id, remote, upstream, requested_directory):
        path = entry / "repository.json"
        registered = load(path) or {}
        branch = registered.get("branch")
        previous = registered.get("clone_directory")
        directory = previous
        if requested_directory:
            chosen = Path(requested_directory)
            if not chosen.is_absolute():
                raise AgentRunError(422, "Enter an absolute directory on the server.")
            chosen = chosen.resolve()
            if not chosen.is_dir() or not os.access(chosen, os.W_OK | os.X_OK):
                raise AgentRunError(422, "Choose an existing writable directory on the server.")
            directory = str(chosen)
        if previous != directory and self.checkout_path(entry, registered).is_dir():
            raise AgentRunError(409, "Delete the current shared clone before changing directories.")
        save(
            path,
            {
                "id": repo_id,
                "branch": branch,
                "upstream": bool(upstream),
                "url": remote,
                "upstream_url": upstream,
                "clone_directory": directory,
            },
        )
        return {"id": repo_id, "base": branch}

    def ensure_checkout(self, entry, repo_id, token=None):
        path = entry / "repository.json"
        metadata = load(path)
        if not metadata or metadata["id"] != repo_id:
            raise AgentRunError(404, "Repository registration unavailable.")
        checkout = self.owned_checkout(entry, metadata, create=True)
        branch = metadata.get("branch")
        if not checkout.is_dir():
            origin, upstream = self.import_urls(entry, metadata)
            with tempfile.TemporaryDirectory(prefix=".clone-", dir=checkout.parent) as scratch:
                staged = Path(scratch) / "checkout"
                branch = clone_repository(staged, origin, upstream, token=token) if token is not None else clone_repository(staged, origin, upstream)
                save(path, {**metadata, "branch": branch, "url": origin, "upstream_url": upstream})
                staged.rename(checkout)
        return Repository(checkout, branch, "origin", "upstream" if metadata["upstream"] else None)

    def clone_list(self, user_id):
        owner = self.imports_for(user_id)
        clones = []
        for path in sorted((owner / "checkouts").glob("*/repository.json")):
            data = load(path)
            if not data:
                continue
            checkout = self.checkout_path(path.parent, data)
            if not checkout.is_dir() or checkout.is_symlink():
                continue
            clones.append({"id": data["id"], "path": str(checkout), "removed": (owner / "removed" / path.parent.name).is_file()})
        return clones

    def purge_checkout(self, entry, repo_id):
        path = entry / "repository.json"
        metadata = load(path)
        if not metadata or metadata["id"] != repo_id:
            raise AgentRunError(404, "Managed clone unavailable.")
        checkout = self.owned_checkout(entry, metadata)
        if checkout.is_dir():
            origin, upstream = self.import_urls(entry, metadata)
            save(path, {**metadata, "url": origin, "upstream_url": upstream})
            shutil.rmtree(checkout)
        return {"id": repo_id}

    async def import_action(self, payload, context):
        remote, source, upstream, target = repository_urls(payload)
        directory = payload.get("clone_directory", "")
        if not isinstance(directory, str) or len(directory) > 4096 or "\x00" in directory:
            raise AgentRunError(422, "Enter a valid clone directory.")
        repo_id = source.casefold()
        if target:
            credentials = await self.accounts.credentials(context.principal.user_id)
            await validate_fork(source, target, token=credentials["token"] if credentials else None)
            repo_id += f" → {target.casefold()}"
        key = repository_key(repo_id)
        imports = self.imports_for(context.principal.user_id)
        async with task_lock(imports / "locks" / key):
            saved = await disk(
                self.save_registration,
                imports / "checkouts" / key,
                repo_id,
                remote,
                upstream,
                directory.strip(),
            )
            await disk((imports / "removed" / key).unlink, True)
            return saved

    async def remove_action(self, payload, context):
        user_id = context.principal.user_id
        repo_id = payload.get("repository")
        if not isinstance(repo_id, str) or repo_id not in await disk(self.available, user_id):
            raise AgentRunError(404, "Repository unavailable.")
        imports = self.imports_for(user_id)
        key = repository_key(repo_id)
        async with task_lock(imports / "locks" / key):
            await disk(save, imports / "removed" / key, {"id": repo_id})
            entry = imports / "checkouts" / key
            metadata = await disk(load, entry / "repository.json")
            clone = self.checkout_path(entry, metadata) if metadata else None
            return {"id": repo_id, "has_checkout": bool(clone and await disk(clone.is_dir))}

    async def purge_action(self, payload, context):
        repo_id = payload.get("repository")
        if not isinstance(repo_id, str):
            raise AgentRunError(404, "Managed clone unavailable.")
        imports = self.imports_for(context.principal.user_id)
        key = repository_key(repo_id)
        async with task_lock(imports / "locks" / key):
            return await disk(self.purge_checkout, imports / "checkouts" / key, repo_id)

    async def attach(self, payload, context, folder, record):
        repo_id = payload.get("repository")
        if record:
            if record["repository"] != repo_id:
                raise AgentRunError(409, "This conversation already has a repository.")
            return self.view(record)

        available = await disk(self.selectable, context.principal.user_id)
        if not isinstance(repo_id, str) or repo_id not in available:
            raise AgentRunError(422, "Choose an imported repository.")
        repo = available[repo_id]
        remote, fork, target = await disk(self.registration, context.principal.user_id, repo_id, repo)
        thread = folder.name
        runs = context.agent_runs
        await runs.create_thread(thread_id=thread)
        record = {
            "owner": context.principal.user_id,
            "thread": thread,
            "repository": repo_id,
            "base": None,
            "base_branch": repo.branch,
            "branch": f"repoflow/{thread}",
            "remote": remote,
            "fork": fork,
            "target": target,
            "upstream_target": target,
        }
        await disk(save, folder / "task.json", record)
        return self.view(record)

    async def prepare_workspace(self, context, folder, record):
        if record.get("base"):
            return
        repo_id = record["repository"]
        user_id = context.principal.user_id
        imports = self.imports_for(user_id)
        key = repository_key(repo_id)
        async with task_lock(imports / "locks" / key):
            repo = self.repositories.get(repo_id)
            if repo is None:
                credentials = await self.accounts.credentials(user_id)
                repo = await disk(self.ensure_checkout, imports / "checkouts" / key, repo_id, credentials["token"] if credentials else "")
            await self.stage_workspace(context, folder, record, repo)

    async def stage_workspace(self, context, folder, record, repo):
        base = await disk(repo.base)
        runs = context.agent_runs
        thread = record["thread"]
        async with runs.reserve_local_workspace(thread_id=thread) as location:
            workspace = location / "repo"
            private = folder / "git"
            if await disk(workspace.exists) or await disk(workspace.is_symlink) or await disk(private.exists):
                raise AgentRunError(409, "An existing task workspace needs recovery.")
            try:
                await disk(prepare, repo, private, workspace, base)
                await disk(save, folder / "task.json", {**record, "base": base, "base_branch": repo.branch})
            except BaseException:
                saved = await disk(load, folder / "task.json")
                if not saved or not saved.get("base"):
                    await disk(shutil.rmtree, workspace, True)
                    await disk(shutil.rmtree, private, True)
                raise
        record.update(base=base, base_branch=repo.branch)

    @staticmethod
    def view(record):
        return {key: value for key, value in record.items() if key not in {"owner", "remote", "task", "tree"}}

    async def review(self, context, folder, record):
        runs = context.agent_runs
        thread = record["thread"]
        async with runs.reserve_local_workspace(thread_id=thread) as location:
            state = await runs.get_state(thread_id=thread)
            messages = state.get("values", {}).get("messages", [])
            answer = next(
                (msg["content"] for msg in reversed(messages) if msg.get("type") == "ai" and not msg.get("tool_calls") and isinstance(msg.get("content"), str) and msg["content"].strip()),
                "",
            )
            requested = record.get("publication", {})
            spec = requested.get("spec", {})
            title = (
                spec.get("title")
                or record.get("title")
                or next(
                    (line.split(":", 1)[1].strip() for line in answer.splitlines() if line.lower().startswith("pr title:")),
                    "",
                )
            )
            title = (title or f"Update {record['fork'].split('/', 1)[1]}")[:120]
            author = await self.accounts.commit_identity(record["owner"])
            changes = await disk(
                capture,
                folder / "git",
                location / "repo",
                record["base"],
                title,
                record,
                author,
            )
            if record.get("commit") != changes["commit"]:
                record.pop("pr_url", None)
                record.pop("pr_form_url", None)
                record.pop("publication_revision", None)
                if (record.get("author_rewrite") or {}).get("commit") != changes["commit"]:
                    record.pop("author_rewrite", None)
            record.update(changes, title=title, report=answer[:12000])
            record["connected_commit_author"] = author
            await self.publications.refresh_receipt(record)
            if requested.get("state") == "waiting_for_review":
                record.setdefault("upstream_target", record["target"])
                record.update(pr_body=spec["body"], target=spec["target"], base_branch=spec["base_branch"])
                requested["state"] = "pushed" if record.get("published_commit") == record.get("commit") and record.get("commit") else "ready_for_confirmation"
            record.setdefault("pr_body", answer[:12000])
            if record.get("commit"):
                record.setdefault("publication_revision", os.urandom(16).hex())
            await disk(save, folder / "task.json", record)

    async def rewrite_author(self, payload, context, folder, record):
        if payload.get("commit") != record.get("commit") or record.get("commit") != record.get("published_commit") or not record.get("commit"):
            raise AgentRunError(409, "Refresh the published commit before correcting its author.")
        author = await self.accounts.commit_identity(record["owner"])
        if author is None:
            raise AgentRunError(409, "Connect GitHub before correcting your commit author.")
        if record.get("commit_author") == author:
            raise AgentRunError(409, "The current commit already uses your GitHub identity.")
        async with context.agent_runs.reserve_local_workspace(thread_id=record["thread"]) as location:
            previous = record["commit"]
            from .git_tasks import replace_author

            changes = await disk(replace_author, folder / "git", location / "repo", previous, author)
            record.update(changes, connected_commit_author=author)
            record["author_rewrite"] = {"previous_commit": previous, "commit": changes["commit"]}
            record["publication_revision"] = os.urandom(16).hex()
            record.pop("pr_form_url", None)
            record.pop("pr_url", None)
            await disk(save, folder / "task.json", record)

    async def push(self, payload, folder, record):
        if not record.get("commit") or payload.get("commit") != record["commit"]:
            raise AgentRunError(409, "Review the current commit before pushing.")
        if record.get("published_commit") != record["commit"]:
            replacement = record.get("author_rewrite")
            if replacement and (replacement.get("commit") != record["commit"] or payload.get("replace_commit") != replacement.get("previous_commit")):
                raise AgentRunError(409, "Explicitly confirm the old and new commits before updating the fork author.")
            credentials = await self.accounts.credentials(record["owner"])
            if credentials:
                await self.accounts.repository(record["owner"], record["fork"], require_push=True, credentials=credentials)
                author = await self.accounts.commit_identity(record["owner"], credentials=credentials)
                if record.get("commit_author") != author:
                    raise AgentRunError(409, "Refresh changes to prepare a commit with your connected GitHub identity before pushing.")
            elif record.get("repository") and record["repository"] not in self.repositories:
                raise AgentRunError(409, "Connect your GitHub account in Settings → Connections before pushing.")
            await disk(
                publish,
                folder / "git",
                record["remote"],
                record["commit"],
                record["branch"],
                credentials["token"] if credentials else None,
                replacement["previous_commit"] if replacement else None,
            )
            record.pop("author_rewrite", None)
            record["published_commit"] = record["commit"]
            if record.get("publication"):
                record["publication"]["state"] = "pushed"
            record["push_receipt"] = {"repository": record["fork"], "branch": record["branch"], "commit": record["commit"]}
            record["pr_form_url"] = compare_url(
                record["target"],
                record["fork"],
                record["base_branch"],
                record["branch"],
                record["title"],
                record.get("pr_body", record["report"]),
            )
            record["pr_url"] = record["pr_form_url"]
            await disk(save, folder / "task.json", record)

    async def task_action(self, name, payload, context):
        folder = self.root / identifier(payload.get("id"))
        if name in {"current", "prepare"}:
            record = await disk(load, folder / "task.json")
            if not record or record["owner"] != context.principal.user_id:
                return {"prepared": False} if name == "prepare" else None
            if name == "current":
                return self.view(record)
            if record.get("base"):
                return {"prepared": False}
        async with task_lock(folder):
            record = await disk(load, folder / "task.json")
            if record and record["owner"] != context.principal.user_id:
                raise AgentRunError(404, "Repository unavailable.")
            if name == "attach":
                return await self.attach(payload, context, folder, record)
            if not record:
                raise AgentRunError(404, "No repository attached to this conversation.")
            if name == "prepare":
                if record.get("base"):
                    return {"prepared": False}
                await self.prepare_workspace(context, folder, record)
                return {"prepared": True}
            if name == "review":
                if not record.get("base"):
                    raise AgentRunError(409, "Prepare the repository in the conversation to review changes.")
                await self.review(context, folder, record)
            if name == "rewrite-author":
                await self.rewrite_author(payload, context, folder, record)
            if name == "configure-publication":
                await self.publications.configure(payload, record)
                await disk(save, folder / "task.json", record)
            if name == "create-pr":
                await self.publications.create_pr(payload, folder, record)
            if name == "push":
                await self.push(payload, folder, record)
            return self.view(record)

    def action(self, name):
        async def handle(payload, context):
            if name.startswith("ssh-"):
                if not context.principal.user_id or context.interaction != "session":
                    raise AgentRunError(403, "SSH profiles require an authenticated browser session.")
                return await disk(self.ssh.action, name, context.principal.user_id, payload)
            if name.startswith("github-"):
                if not context.principal.user_id or context.interaction != "session":
                    raise AgentRunError(403, "GitHub connections require an authenticated browser session.")
                owner = context.principal.user_id
                if name == "github-status":
                    return await self.accounts.status(owner)
                if name == "github-login":
                    return await self.accounts.begin_login(owner)
                if name == "github-cancel":
                    return await self.accounts.cancel_login(owner)
                if name == "github-token":
                    return await self.accounts.connect_token(owner, payload.get("token"))
                if name == "github-disconnect":
                    return await self.accounts.disconnect(owner)
                if name == "github-check":
                    return await self.accounts.check(owner)
                if name == "github-repositories":
                    return await self.accounts.repositories(owner, payload.get("page", 1))
                if name == "github-repository":
                    data = await self.accounts.repository(owner, payload.get("repository"))
                    parent = data.get("parent") or {}
                    return {"name": data["full_name"], "parent": parent.get("full_name"), "can_push": bool((data.get("permissions") or {}).get("push"))}
                raise AgentRunError(404, "Unknown GitHub connection action.")
            if not context.principal.user_id or context.interaction != "session" or context.agent_runs is None:
                raise AgentRunError(403, "Repository tasks require an authenticated browser session.")
            if not context.principal.is_admin:
                if payload.get("clone_directory") or payload.get("repository") in self.repositories:
                    raise AgentRunError(403, "Operator checkouts and custom host directories require an administrator.")
                if payload.get("id"):
                    own_record = await disk(load, self.publications.folder(payload["id"]) / "task.json")
                    if own_record and own_record["owner"] != context.principal.user_id:
                        raise AgentRunError(404, "Repository unavailable.")
                    if own_record and own_record["repository"] in self.repositories:
                        raise AgentRunError(403, "Operator checkouts require an administrator.")
            if name in {"publication", "publication-options", "history", "history-diff"}:
                folder, record = await self.publications.record(payload.get("id"), context.principal.user_id)
                if name == "history":
                    return await self.history.entries(folder, payload.get("page", 1))
                if name == "history-diff":
                    return await self.history.diff(folder, payload.get("commit"))
                return self.publications.public(record) if name == "publication" else await self.publications.options(record)
            if name == "repositories":
                listed = await disk(self.repository_list, context.principal.user_id)
                return listed if context.principal.is_admin else [item for item in listed if item["id"] not in self.repositories]
            if name == "validate-links":
                try:
                    _, source, _, target = repository_urls(payload)
                    if target:
                        credentials = await self.accounts.credentials(context.principal.user_id)
                        await validate_fork(source, target, token=credentials["token"] if credentials else None)
                except RepositoryLinkError as exc:
                    return {"valid": False, "reason": exc.reason}
                return {"valid": True}
            if name == "import":
                return await self.import_action(payload, context)
            if name == "remove":
                return await self.remove_action(payload, context)
            if name == "clones":
                return await disk(self.clone_list, context.principal.user_id)
            if name == "purge-clone":
                return await self.purge_action(payload, context)
            if name == "execution":
                own = await disk(self.ssh.list, context.principal.user_id)
                view = self.execution.view()
                if not context.principal.is_admin:
                    view["hosts"] = []
                return {**view, "hosts": view["hosts"] + [item["id"] for item in own], "profiles": own}
            if name == "connect":
                if any(item["id"] == payload.get("host") for item in await disk(self.ssh.list, context.principal.user_id)):
                    return await disk(partial(self.ssh.execute, context.principal.user_id, payload["host"], connect=True))
                if not context.principal.is_admin:
                    raise AgentRunError(404, "SSH host unavailable.")
                return await disk(self.execution.connect, payload.get("host"))
            if name in {"test-settings", "save-test-settings"}:
                return await self.test_settings(name, payload, context)
            if name == "conversation-branches":
                thread_ids = payload.get("thread_ids")
                if not isinstance(thread_ids, list) or len(thread_ids) > 64:
                    raise AgentRunError(422, "Expected up to 64 conversation IDs.")
                return await disk(self.conversation_branches, thread_ids, context.principal.user_id)
            return await self.task_action(name, payload, context)

        return handle

    async def test_settings(self, name, payload, context):
        owner = context.principal.user_id
        repository = payload.get("repository")
        available = await disk(self.available, owner)
        if not isinstance(repository, str) or repository not in available:
            raise AgentRunError(404, "Repository unavailable.")
        key = repository_key(repository)
        folder = self.imports_for(owner) / "settings" / key
        config = folder / "regression.json"
        if name == "test-settings":
            return await disk(load, config) or {"command": "", "directory": ""}

        command = payload.get("command")
        directory = payload.get("directory")
        if not isinstance(command, str) or len(command) > 300 or any(ord(char) < 32 for char in command):
            raise AgentRunError(422, "Use a single command of up to 300 characters.")
        if not isinstance(directory, str) or len(directory) > 240:
            raise AgentRunError(422, "Enter a path relative to the repository.")
        directory = directory.strip()
        path = PurePosixPath(directory)
        if path.is_absolute() or ".." in path.parts or any(char in directory for char in ("\\", ":", "\x00", "\n", "\r")):
            raise AgentRunError(422, "Enter a path relative to the repository.")
        data = {"command": command.strip(), "directory": str(path) if directory else ""}
        async with task_lock(folder):
            await disk(save, config, data)
        return data


@extension(api="0.2.11", name="repoflow-repository-tasks")
def install(registry, config):
    tasks = Tasks(config)
    registry.task_lifecycle(tasks)
    registry.service(tasks.accounts)
    registry.plugin(
        PluginContribution(
            namespace=NAMESPACE,
            title="RepoFlow 仓库任务",
            description="选择仓库、运行 Agent 并审阅 Git 改动。",
            enabled=True,
            frontend=BrowserAssets("repoflow.repositories.v1", Path(__file__).parent),
            tools=tasks.publications.tools(),
            backend=tuple(
                BackendAction(name, tasks.action(name))
                for name in (
                    "repositories",
                    "validate-links",
                    "import",
                    "remove",
                    "clones",
                    "purge-clone",
                    "execution",
                    "connect",
                    "ssh-list",
                    "ssh-probe",
                    "ssh-save",
                    "ssh-delete",
                    "ssh-test",
                    "test-settings",
                    "save-test-settings",
                    "conversation-branches",
                    "current",
                    "attach",
                    "prepare",
                    "review",
                    "rewrite-author",
                    "push",
                    "publication",
                    "publication-options",
                    "configure-publication",
                    "create-pr",
                    "history",
                    "history-diff",
                    "github-status",
                    "github-login",
                    "github-cancel",
                    "github-token",
                    "github-disconnect",
                    "github-check",
                    "github-repositories",
                    "github-repository",
                )
            ),
        )
    )
