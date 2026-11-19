"""Account actions keep encrypted credential files off the event loop."""

from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest


@pytest.mark.asyncio
async def test_connect_status_and_disconnect_use_async_storage(tmp_path, monkeypatch):
    package = Path(__file__).resolve().parents[3] / "examples/deerflow-extension-repository-tasks"
    monkeypatch.syspath_prepend(str(package))
    from repoflow_repository_tasks import Tasks
    from repoflow_repository_tasks import accounts as module

    monkeypatch.delenv("DEER_FLOW_CREDENTIALS_KEY", raising=False)
    client_class = httpx.AsyncClient

    def response(request):
        assert request.url.path == "/user"
        return httpx.Response(200, json={"id": 123, "login": "alice"})

    monkeypatch.setattr(module.httpx, "AsyncClient", lambda **kwargs: client_class(transport=httpx.MockTransport(response), **kwargs))
    tasks = Tasks({"storage_path": str(tmp_path / "tasks")})
    context = SimpleNamespace(principal=SimpleNamespace(user_id="alice", is_admin=False), interaction="session")
    assert (await tasks.action("github-token")({"token": "offline_test_personal_token"}, context))["connected"]
    assert (await tasks.action("github-status")({}, context))["account"]["login"] == "alice"
    assert (await tasks.action("github-check")({}, context))["verified"]
    assert not (await tasks.action("github-disconnect")({}, context))["connected"]


@pytest.mark.asyncio
async def test_publication_request_and_status_keep_files_offloop(tmp_path, monkeypatch):
    import threading
    from uuid import uuid4

    from deerflow_extension_api.auth import ExtensionPrincipal
    from deerflow_extension_api.plugins import ToolContext

    package = Path(__file__).resolve().parents[3] / "examples/deerflow-extension-repository-tasks"
    monkeypatch.syspath_prepend(str(package))
    import repoflow_repository_tasks as plugin

    tasks = plugin.Tasks({"storage_path": str(tmp_path / "tasks")})
    thread = str(uuid4())
    record = {"owner": "alice", "thread": thread, "repository": "alice/fork", "fork": "alice/fork", "target": "upstream/repo", "base_branch": "master", "branch": "repoflow/test"}
    await plugin.disk(plugin.save, tasks.root / thread / "task.json", record)
    loop_thread = threading.get_ident()
    reads = []
    load = plugin.load

    def checked_load(path):
        assert threading.get_ident() != loop_thread
        reads.append(path)
        return load(path)

    tasks.publications.load = checked_load
    context = ToolContext(ExtensionPrincipal("alice"), {}, thread, run_id="host-run")
    result = await tasks.publications.tool("prepare_publication", {"title": "Fix", "body": "Details", "target": "upstream"}, context)
    assert result["publication"]["state"] == "waiting_for_review"
    assert (await tasks.publications.tool("publication_status", {}, context))["published_commit"] is None
    assert len(reads) == 3


@pytest.mark.asyncio
async def test_host_baseline_file_is_read_offloop(tmp_path, monkeypatch):
    import asyncio
    import subprocess
    import threading
    from uuid import uuid4

    from deerflow_extension_api.auth import ExtensionPrincipal
    from deerflow_extension_api.plugins import ToolContext

    package = Path(__file__).resolve().parents[3] / "examples/deerflow-extension-repository-tasks"
    monkeypatch.syspath_prepend(str(package))
    import repoflow_repository_tasks as plugin

    def setup():
        source = tmp_path / "source"
        source.mkdir()

        def git(*args):
            return subprocess.check_output(["git", "-C", str(source), *args], text=True).strip()

        git("init", "-b", "master")
        (source / "README.md").write_text("original\n", encoding="utf-8", newline="\n")
        git("add", ".")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "base")
        tasks = plugin.Tasks({"storage_path": str(tmp_path / "tasks")})
        thread = str(uuid4())
        folder = tasks.root / thread
        folder.mkdir()
        location = tmp_path / "workspace"
        location.mkdir()
        plugin.prepare(plugin.Repository(source, "master", "origin", None), folder / "git", location / "repo", git("rev-parse", "HEAD"))
        plugin.save(folder / "task.json", {"owner": "alice", "thread": thread, "base": git("rev-parse", "HEAD")})
        return tasks, thread, location

    tasks, thread, location = await asyncio.to_thread(setup)
    context = ToolContext(ExtensionPrincipal("alice"), {}, thread, run_id="host-run")
    loop_thread = threading.get_ident()
    original = tasks.publications.inspect

    def inspect(*args):
        assert threading.get_ident() != loop_thread
        return original(*args)

    tasks.publications.inspect = inspect
    result = await tasks.publications.tool("repository_baseline", {"path": "README.md"}, context)
    assert result["content"] == "original\n"
    await asyncio.to_thread((location / "repo/README.md").write_text, "checkpoint\n", encoding="utf-8", newline="\n")
    await tasks.history.capture(thread, "host-run", "tool: edit_file")
    assert (await tasks.history.entries(tasks.root / thread))["total"] == 1
