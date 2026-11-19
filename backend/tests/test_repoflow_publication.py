"""Real Git snapshots, LangGraph tool dispatch and mocked GitHub HTTP transport."""

import json
import os
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from deerflow_extension_api.agent_runs import AgentRunError

pytestmark = pytest.mark.skipif(os.name != "posix", reason="Host repository storage uses POSIX locks")


@pytest.fixture
def publication(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "examples/deerflow-extension-repository-tasks"))
    monkeypatch.setenv("DEER_FLOW_CREDENTIALS_KEY", "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=")
    import repoflow_repository_tasks as plugin
    from repoflow_repository_tasks.git_tasks import Repository, prepare

    source = tmp_path / "source"
    source.mkdir()

    def git(*args):
        return subprocess.check_output(["git", "-C", str(source), *args], text=True).strip()

    git("init", "-b", "master")
    git("config", "user.name", "Fixture")
    git("config", "user.email", "fixture@example.test")
    (source / "README.md").write_text("base\n", encoding="utf-8", newline="\n")
    git("add", ".")
    git("commit", "-m", "base")
    tasks = plugin.Tasks({"storage_path": str(tmp_path / "tasks")})
    thread = str(uuid4())
    folder = tasks.root / thread
    folder.mkdir()
    location = tmp_path / "workspace"
    location.mkdir()
    base = git("rev-parse", "HEAD")
    prepare(Repository(source, "master", "origin", None), folder / "git", location / "repo", base)
    (location / "repo/README.md").write_text("changed\n", encoding="utf-8", newline="\n")
    plugin.save(
        folder / "task.json",
        {
            "owner": "alice",
            "thread": thread,
            "repository": "alice/fork → upstream/repo",
            "base": base,
            "base_branch": "master",
            "branch": f"repoflow/{thread}",
            "remote": "https://github.com/alice/fork.git",
            "fork": "alice/fork",
            "target": "upstream/repo",
        },
    )

    class Runs:
        busy = False

        @asynccontextmanager
        async def reserve_local_workspace(self, **kwargs):
            if self.busy:
                raise AgentRunError(409, "Thread workspace is busy")
            yield location

        async def get_state(self, **kwargs):
            return {"values": {"messages": [{"type": "ai", "content": "PR title: Fix docs\nActual test report"}]}}

    runs = Runs()
    context = SimpleNamespace(principal=SimpleNamespace(user_id="alice", is_admin=False), interaction="session", agent_runs=runs)
    requests = []
    client_class = httpx.AsyncClient
    posted = []
    remote_pr = {"number": 42, "state": "open", "draft": True, "merged": False}

    def respond(request):
        requests.append(request)
        assert request.headers["Authorization"] == "Bearer offline_personal_token"
        if request.url.path == "/user":
            return httpx.Response(200, json={"id": 12, "login": "alice"})
        if request.url.path.endswith("/pulls/42"):
            return httpx.Response(200, json=remote_pr)
        if request.url.path.endswith("/pulls"):
            if request.method == "POST":
                posted.append(json.loads(request.content))
                return httpx.Response(201, json={"number": 42, "draft": posted[-1]["draft"]})
            return httpx.Response(200, json=[])
        if "/branches/" in request.url.path:
            current = plugin.load(folder / "task.json")
            sha = current.get("commit") if "/branches/repoflow/" in request.url.path else current["base"]
            return httpx.Response(200, json={"name": "master", "commit": {"sha": sha}})
        if request.url.path.endswith("/branches"):
            return httpx.Response(200, json=[{"name": "master"}, {"name": "release/1"}])
        return httpx.Response(200, json={"full_name": request.url.path[7:], "default_branch": "master", "permissions": {"push": True}})

    class Client(client_class):
        def __init__(self, **kwargs):
            super().__init__(transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr(plugin.accounts.httpx, "AsyncClient", Client)
    return SimpleNamespace(tasks=tasks, thread=thread, folder=folder, context=context, requests=requests, posted=posted, plugin=plugin, remote_pr=remote_pr, workspace=location / "repo")


async def review(p):
    return await p.tasks.action("review")({"id": p.thread}, p.context)


@pytest.mark.asyncio
async def test_model_request_uses_real_tool_node_and_cannot_publish(publication):
    from deerflow_extension_api.plugins import PluginContribution
    from langchain_core.messages import AIMessage
    from langgraph.graph import END, START, MessagesState, StateGraph
    from langgraph.prebuilt import ToolNode

    from deerflow.extensions.plugin_tools import build_plugin_tools
    from deerflow.extensions.registry import ExtensionRegistry

    p = publication
    registry = ExtensionRegistry()
    with registry.attributed_to("fixture"):
        registry.plugin(PluginContribution(namespace="repoflow.repositories", title="Repository", enabled=True, tools=p.tasks.publications.tools()))
    tools = build_plugin_tools(registry.build())
    tool = next(t for t in tools if "prepare_publication" in t.name)
    graph = StateGraph(MessagesState)
    graph.add_node("tools", ToolNode(tools))
    graph.add_edge(START, "tools")
    graph.add_edge("tools", END)
    agent = graph.compile()
    args = {"title": "Solution", "body": "Reviewed description", "target": "fork"}
    result = await agent.ainvoke({"messages": [AIMessage(content="", tool_calls=[{"id": "request", "name": tool.name, "args": args}])]}, context={"user_id": "alice", "thread_id": p.thread, "run_id": "host-run"})
    queued = json.loads(result["messages"][-1].content)
    assert queued["publication"]["state"] == "waiting_for_review"
    assert queued["published_commit"] is None and p.requests == []
    result = await review(p)
    assert result["target"] == "alice/fork" and result["commit"]
    assert result["publication"]["state"] == "ready_for_confirmation"
    assert result["pr_body"] == args["body"]
    assert p.requests == []


@pytest.mark.asyncio
async def test_idle_review_and_owner_boundaries(publication):
    p = publication
    p.context.agent_runs.busy = True
    with pytest.raises(AgentRunError) as busy:
        await review(p)
    assert busy.value.status_code == 409
    p.context.agent_runs.busy = False
    assert (await review(p))["commit"]
    p.context.principal.user_id = "bob"
    with pytest.raises(AgentRunError) as hidden:
        await review(p)
    assert hidden.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("target", ["alice/fork", "upstream/repo"])
async def test_configure_selects_real_target_and_push_returns_only_form(publication, monkeypatch, target):
    p = publication
    await p.tasks.action("github-token")({"token": "offline_personal_token"}, p.context)
    reviewed = await review(p)
    data = await p.tasks.action("configure-publication")({"id": p.thread, "commit": reviewed["commit"], "target": target, "base_branch": "release/1", "title": "Final title", "body": "Final body"}, p.context)
    assert data["target"] == target and data["upstream_target"] == "upstream/repo"
    assert data["publication_revision"]
    assert "+changed" in data["pr_diff"] and "-base" in data["pr_diff"]
    sent = []
    monkeypatch.setattr(p.plugin.git_tasks.subprocess, "run", lambda command, **kwargs: sent.append(command))
    pushed = await p.tasks.action("push")({"id": p.thread, "commit": data["commit"]}, p.context)
    assert pushed["published_commit"] == data["commit"]
    assert pushed["push_receipt"] == {"repository": "alice/fork", "branch": data["branch"], "commit": data["commit"]}
    current = await p.tasks.action("current")({"id": p.thread}, p.context)
    assert current["published_commit"] == current["commit"]
    assert not {"owner", "remote", "task", "tree"} & current.keys()
    assert pushed["pr_form_url"].startswith(f"https://github.com/{target}/compare/")
    assert "title=Final+title" in pushed["pr_form_url"]
    assert p.posted == [] and len(sent) == 1


@pytest.mark.asyncio
async def test_pr_creation_requires_exact_separate_confirmation_and_is_idempotent(publication, monkeypatch):
    p = publication
    await p.tasks.action("github-token")({"token": "offline_personal_token"}, p.context)
    data = await review(p)
    monkeypatch.setattr(p.plugin.git_tasks.subprocess, "run", lambda *args, **kwargs: None)
    data = await p.tasks.action("push")({"id": p.thread, "commit": data["commit"]}, p.context)
    for fields in ({"commit": data["commit"]}, {"commit": "changed", "revision": data["publication_revision"]}):
        with pytest.raises(AgentRunError):
            await p.tasks.action("create-pr")({"id": p.thread, **fields}, p.context)
    fields = {"id": p.thread, "commit": data["commit"], "revision": data["publication_revision"], "draft": True, "confirmed": True}
    for missing in ("confirmed", "draft"):
        with pytest.raises(AgentRunError) as unconfirmed:
            await p.tasks.action("create-pr")({key: value for key, value in fields.items() if key != missing}, p.context)
        assert unconfirmed.value.status_code == 422
    assert p.posted == []
    result = await p.tasks.action("create-pr")(fields, p.context)
    assert result["pull_request"] == {"number": 42, "url": "https://github.com/upstream/repo/pull/42", "draft": True, "state": "open", "merged": False, "repository": "upstream/repo"}
    assert len(p.posted) == 1 and p.posted[0]["base"] == "master"
    assert (await p.tasks.action("create-pr")(fields, p.context))["pull_request"] == result["pull_request"]
    assert len(p.posted) == 1
    p.context.interaction = "other"
    with pytest.raises(AgentRunError):
        await p.tasks.action("create-pr")(fields, p.context)


@pytest.mark.asyncio
async def test_readonly_host_changes_and_baseline_are_owner_scoped(publication):
    from deerflow_extension_api.auth import ExtensionPrincipal
    from deerflow_extension_api.plugins import ToolContext

    p = publication
    context = ToolContext(ExtensionPrincipal("alice"), {}, p.thread, run_id="host-run")
    changes = await p.tasks.publications.tool("repository_changes", {}, context)
    assert "README.md" in changes["status"]
    assert "+changed" in changes["tracked_diff"]
    original = await p.tasks.publications.tool("repository_baseline", {"path": "README.md"}, context)
    assert original["content"] == "base\n" and not original["truncated"]
    assert p.plugin.load(p.folder / "task.json").get("commit") is None
    assert p.requests == []
    for path in ("../secret", "/etc/passwd", ".git/config"):
        with pytest.raises(AgentRunError):
            await p.tasks.publications.tool("repository_baseline", {"path": path}, context)
    foreign = ToolContext(ExtensionPrincipal("bob"), {}, p.thread, run_id="host-run")
    with pytest.raises(AgentRunError) as denied:
        await p.tasks.publications.tool("repository_changes", {}, foreign)
    assert denied.value.status_code == 404


@pytest.mark.asyncio
async def test_review_uses_the_connected_github_author_and_preserves_published_history(publication):
    p = publication
    preview = await review(p)
    await p.tasks.action("github-token")({"token": "offline_personal_token"}, p.context)
    with pytest.raises(AgentRunError) as stale:
        await p.tasks.action("push")({"id": p.thread, "commit": preview["commit"]}, p.context)
    assert stale.value.status_code == 409
    owned = await review(p)
    assert owned["commit"] != preview["commit"]
    assert owned["commit_author"] == {"name": "alice", "email": "12+alice@users.noreply.github.com"}
    actual = subprocess.check_output(["git", "--git-dir", str(p.folder / "git"), "show", "-s", "--format=%an|%ae|%cn|%ce", owned["commit"]], text=True).strip()
    assert actual == "alice|12+alice@users.noreply.github.com|alice|12+alice@users.noreply.github.com"
    assert (await review(p))["commit"] == owned["commit"]
    # Existing published commits retain their actual authorship and SHA.
    saved = p.plugin.load(p.folder / "task.json")
    saved.update(preview, published_commit=preview["commit"])
    p.plugin.save(p.folder / "task.json", saved)
    unchanged = await review(p)
    assert unchanged["commit"] == preview["commit"]
    assert unchanged["commit_author"]["name"] == "RepoFlow"


@pytest.mark.asyncio
async def test_pr_receipt_survives_edits_and_refreshes_closed_state(publication, monkeypatch):
    p = publication
    await p.tasks.action("github-token")({"token": "offline_personal_token"}, p.context)
    data = await review(p)
    original_run = p.plugin.git_tasks.subprocess.run
    monkeypatch.setattr(p.plugin.git_tasks.subprocess, "run", lambda *args, **kwargs: None)
    data = await p.tasks.action("push")({"id": p.thread, "commit": data["commit"]}, p.context)
    data = await p.tasks.action("create-pr")({"id": p.thread, "commit": data["commit"], "revision": data["publication_revision"], "draft": True, "confirmed": True}, p.context)
    # Restore real Git before computing a new preview.
    monkeypatch.setattr(p.plugin.git_tasks.subprocess, "run", original_run)
    p.remote_pr["state"] = "closed"
    data = await review(p)
    assert data["pull_request"]["state"] == "closed" and not data.get("pr_status_error")
    data = await p.tasks.action("configure-publication")({"id": p.thread, "commit": data["commit"], "target": "upstream/repo", "base_branch": "master", "title": "Saved", "body": "Retained"}, p.context)
    assert data["pull_request"]["number"] == 42
    (p.workspace / "README.md").write_text("next edit\n", encoding="utf-8")
    data = await review(p)
    assert data["commit"] != data["published_commit"]
    assert data["title"] == "Saved" and data["pr_body"] == "Retained"
    assert data["pull_request"]["number"] == 42
    assert len(p.posted) == 1


@pytest.mark.asyncio
async def test_author_only_replacement_keeps_tree_and_requires_explicit_lease(publication, monkeypatch):
    p = publication
    old = await review(p)
    saved = p.plugin.load(p.folder / "task.json")
    saved["published_commit"] = old["commit"]
    p.plugin.save(p.folder / "task.json", saved)
    await p.tasks.action("github-token")({"token": "offline_personal_token"}, p.context)
    rewritten = await p.tasks.action("rewrite-author")({"id": p.thread, "commit": old["commit"]}, p.context)
    assert rewritten["commit"] != old["commit"]
    assert rewritten["author_rewrite"] == {"previous_commit": old["commit"], "commit": rewritten["commit"]}
    assert "tree" not in rewritten

    def show(commit, field):
        return subprocess.check_output(["git", "--git-dir", str(p.folder / "git"), "show", "-s", "--format=" + field, commit], text=True).strip()

    for field in ("%T", "%P", "%B"):
        assert show(old["commit"], field) == show(rewritten["commit"], field)
    assert rewritten["commit_author"]["name"] == "alice"
    assert (await review(p))["commit"] == rewritten["commit"]
    sent = []
    monkeypatch.setattr(p.plugin.git_tasks.subprocess, "run", lambda args, **kwargs: sent.append(args))
    with pytest.raises(AgentRunError) as missing:
        await p.tasks.action("push")({"id": p.thread, "commit": rewritten["commit"]}, p.context)
    assert missing.value.status_code == 409 and not sent
    await p.tasks.action("push")({"id": p.thread, "commit": rewritten["commit"], "replace_commit": old["commit"]}, p.context)
    assert f"--force-with-lease=refs/heads/{old['branch']}:{old['commit']}" in sent[0]


@pytest.mark.asyncio
async def test_author_correction_rejects_unreviewed_file_changes(publication):
    p = publication
    old = await review(p)
    saved = p.plugin.load(p.folder / "task.json")
    saved["published_commit"] = old["commit"]
    p.plugin.save(p.folder / "task.json", saved)
    await p.tasks.action("github-token")({"token": "offline_personal_token"}, p.context)
    (p.workspace / "README.md").write_text("unreviewed\n", encoding="utf-8")
    with pytest.raises(AgentRunError) as dirty:
        await p.tasks.action("rewrite-author")({"id": p.thread, "commit": old["commit"]}, p.context)
    assert dirty.value.status_code == 409


def test_author_replacement_lease_refuses_new_remote_commits(publication, tmp_path):
    from repoflow_repository_tasks.git_tasks import capture, publish, replace_author

    p = publication
    repo = p.folder / "git"
    remote = tmp_path / "remote.git"
    subprocess.check_call(["git", "init", "--bare", str(remote)], stdout=subprocess.DEVNULL)
    record = p.plugin.load(p.folder / "task.json")
    old = capture(repo, p.workspace, record["base"], "Change")
    branch = "contribution"
    publish(repo, str(remote), old["commit"], branch)
    new = replace_author(repo, p.workspace, old["commit"], {"name": "alice", "email": "alice@example.test"})
    publish(repo, str(remote), new["commit"], branch, replace_commit=old["commit"])
    with pytest.raises(AgentRunError):
        publish(repo, str(remote), old["commit"], branch, replace_commit=old["commit"])
    assert subprocess.check_output(["git", "--git-dir", str(remote), "rev-parse", "refs/heads/" + branch], text=True).strip() == new["commit"]


@pytest.mark.asyncio
async def test_every_changed_tool_has_a_local_git_checkpoint(publication):
    import asyncio

    from deerflow_extension_api import EXTENSION_TASK_STORE_KEY, ExtensionData
    from repoflow_repository_tasks.agent_context import RepositoryContext

    p = publication
    task = ExtensionData("history-task")
    info = SimpleNamespace(thread_id=p.thread, run_id="history-run")
    await p.tasks.on_task_start(ExtensionData("app"), task, info)
    first = await p.tasks.history.entries(p.folder)
    assert first["total"] == 1
    assert first["entries"][0]["stage"] == "turn_start"
    request = SimpleNamespace(runtime=SimpleNamespace(context={EXTENSION_TASK_STORE_KEY: task}), tool_call={"name": "write_file", "id": "edit-call"})
    location = await p.context.agent_runs.reserve_local_workspace(thread_id=p.thread).__aenter__()

    async def modify(request):
        await asyncio.to_thread((location / "repo/README.md").write_text, "second\n", encoding="utf-8", newline="\n")
        return "edited"

    middleware = RepositoryContext()
    assert await middleware.awrap_tool_call(request, modify) == "edited"
    second = await p.tasks.history.entries(p.folder)
    assert second["total"] == 2
    assert second["entries"][0]["parent"] == first["entries"][0]["commit"]
    diff = await p.tasks.history.diff(p.folder, second["entries"][0]["commit"])
    assert "+second" in diff["diff"] and "-changed" in diff["diff"]

    async def read_only(request):
        return "read"

    assert await middleware.awrap_tool_call(request, read_only) == "read"
    await p.tasks.on_task_stop(None, task, info, None)
    assert (await p.tasks.history.entries(p.folder))["total"] == 2
    assert p.plugin.load(p.folder / "task.json").get("commit") is None
    assert p.requests == []

    async def partial_failure(request):
        await asyncio.to_thread((location / "repo/README.md").write_text, "partial\n", encoding="utf-8", newline="\n")
        raise ValueError("Tool failed after writing")

    with pytest.raises(ValueError):
        await middleware.awrap_tool_call(request, partial_failure)
    assert (await p.tasks.history.entries(p.folder))["total"] == 3
