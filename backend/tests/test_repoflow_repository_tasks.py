"""Local Git and human publication boundaries of the RepoFlow extension."""

import json
import os
import subprocess
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from deerflow_extension_api.agent_runs import AgentRunError

ADAPTER = Path(__file__).resolve().parents[2] / "examples" / "deerflow-extension-repository-tasks"
pytestmark = pytest.mark.skipif(os.name != "posix", reason="Repository task storage uses POSIX locks")


@pytest.fixture
def plugin(monkeypatch):
    monkeypatch.syspath_prepend(str(ADAPTER))
    import repoflow_repository_tasks

    return repoflow_repository_tasks


def run_git(directory, *args):
    return subprocess.check_output(["git", "-C", str(directory), *args], text=True).strip()


@pytest.fixture
def github_metadata(plugin, monkeypatch):
    from repoflow_repository_tasks import github

    metadata = {
        "owner/fork": {
            "full_name": "owner/fork",
            "fork": True,
            "parent": {"full_name": "project/original"},
            "source": {"full_name": "project/original"},
        },
        "project/original": {"full_name": "project/original", "fork": False},
        "other/repo": {"full_name": "other/repo", "fork": False},
    }
    requests = []

    def respond(request):
        assert request.url.scheme == "https"
        assert request.url.host == "api.github.com"
        assert "Authorization" not in request.headers
        assert request.method == "GET"
        repository = request.url.path.removeprefix("/repos/").casefold()
        requests.append(repository)
        if repository == "project/unavailable":
            return httpx.Response(429)
        if repository not in metadata:
            return httpx.Response(404)
        return httpx.Response(200, json=metadata[repository])

    def client(**options):
        return httpx.AsyncClient(transport=httpx.MockTransport(respond), **options)

    monkeypatch.setattr(github, "AsyncClient", client)
    return requests


@pytest.mark.parametrize(
    ("source", "target", "reason"),
    [
        ("owner/fork", "project/original", None),
        ("owner/fork", "", None),
        ("project/original", "owner/fork", "links-reversed"),
        ("other/repo", "project/original", "not-a-fork"),
        ("owner/fork", "other/repo", "different-network"),
        ("owner/fork", "owner/FORK.git", "same-repository"),
        ("owner/absent", "project/original", "contribution-unavailable"),
        ("owner/fork", "project/absent", "target-unavailable"),
        ("owner/fork", "project/unavailable", "github-unavailable"),
        ("owner/fork/tree/main", "project/original", "contribution-url"),
    ],
)
@pytest.mark.asyncio
async def test_repository_link_check_and_import_guard(plugin, github_metadata, tmp_path, source, target, reason):
    tasks = plugin.Tasks({"storage_path": str(tmp_path / "store")})
    context = SimpleNamespace(
        principal=SimpleNamespace(is_admin=True, user_id="owner"),
        agent_runs=object(),
        interaction="session",
    )
    upstream = f"https://github.com/{target}" if target else ""
    payload = {"url": f"https://github.com/{source}", "upstream_url": upstream}
    result = await tasks.action("validate-links")(payload, context)
    if reason is None:
        assert result == {"valid": True}
        assert github_metadata == (["owner/fork"] if target else [])
    else:
        assert result == {"valid": False, "reason": reason}
        with pytest.raises(plugin.RepositoryLinkError) as rejected:
            await tasks.action("import")(payload, context)
        assert rejected.value.reason == reason
        assert not tasks.available("owner")


@pytest.mark.asyncio
async def test_regression_settings_are_validated_and_scoped_to_repository_owner(plugin, tmp_path):
    options = {
        "storage_path": str(tmp_path / "store"),
        "repositories": {"sample": {"path": str(tmp_path), "branch": "main"}},
    }
    tasks = plugin.Tasks(options)

    def session(owner, admin=True):
        return SimpleNamespace(
            principal=SimpleNamespace(user_id=owner, is_admin=admin),
            agent_runs=object(),
            interaction="session",
        )

    alice = session("alice")
    fields = {"repository": "sample", "command": "npm test", "directory": "frontend/./"}
    save_settings = tasks.action("save-test-settings")
    expected = {"command": "npm test", "directory": "frontend"}
    assert await save_settings(fields, alice) == expected
    fetch_settings = plugin.Tasks(options).action("test-settings")
    assert await fetch_settings({"repository": "sample"}, alice) == expected
    assert await fetch_settings({"repository": "sample"}, session("bob")) == {"command": "", "directory": ""}
    for invalid in ({"directory": "../frontend"}, {"directory": "/etc"}, {"command": "npm test\nwhoami"}):
        with pytest.raises(AgentRunError) as error:
            await save_settings({**fields, **invalid}, alice)
        assert error.value.status_code == 422
    assert await fetch_settings({"repository": "sample"}, alice) == expected
    with pytest.raises(AgentRunError) as error:
        await save_settings(fields, session("alice", admin=False))
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_sidebar_branches_are_owner_scoped_and_operator_ssh_aliases_are_admin_only(plugin, tmp_path, monkeypatch):
    from repoflow_repository_tasks.execution import subprocess as execution_process

    tasks = plugin.Tasks(
        {
            "storage_path": str(tmp_path / "store"),
            "execution": {"connections": {"devbox": {"origin": "https://devbox.example.test/"}}},
        }
    )
    own = str(uuid4())
    foreign = str(uuid4())
    plugin.save(tasks.root / own / "task.json", {"owner": "alice", "branch": "repoflow/" + own, "repository": "sample"})
    plugin.save(tasks.root / foreign / "task.json", {"owner": "eve", "branch": "repoflow/" + foreign, "repository": "private"})
    context = SimpleNamespace(
        principal=SimpleNamespace(is_admin=True, user_id="alice"),
        agent_runs=object(),
        interaction="session",
    )
    assert await tasks.action("execution")({}, context) == {"ssh_host": None, "hosts": ["devbox"], "profiles": []}
    assert await tasks.action("conversation-branches")({"thread_ids": [own, foreign, "../private"]}, context) == {
        own: {"repository": "sample", "branch": "repoflow/" + own},
    }
    calls = []
    event_loop_thread = threading.get_ident()

    def ssh(args, **kwargs):
        assert threading.get_ident() != event_loop_thread
        calls.append(args)
        assert kwargs["check"] is True

    monkeypatch.setattr(execution_process, "run", ssh)
    with pytest.raises(AgentRunError) as unknown:
        await tasks.action("connect")({"host": "unconfigured"}, context)
    assert unknown.value.status_code == 404
    with pytest.raises(AgentRunError) as denied:
        await tasks.action("connect")(
            {"host": "devbox"},
            SimpleNamespace(principal=context.principal, agent_runs=object(), interaction="model"),
        )
    assert denied.value.status_code == 403
    assert not calls
    assert await tasks.action("connect")({"host": "devbox"}, context) == {
        "host": "devbox",
        "origin": "https://devbox.example.test",
    }
    assert calls[0][0] == "ssh"
    assert "StrictHostKeyChecking=yes" in calls[0]
    assert calls[0][-2] == "devbox"
    assert calls[0][-1].startswith('systemctl --user start repoflow.target && test "$(curl ')
    assert calls[0][-1].endswith('http://localhost:12026/health/ready)" = 200')


@pytest.mark.parametrize("origin", ["javascript:alert(1)", "http://example.test", "https://name:secret@example.test", "https://example.test/redirect"])
def test_ssh_origin_accepts_only_approved_origin_shapes(plugin, origin):
    from repoflow_repository_tasks.execution import Execution

    with pytest.raises(ValueError):
        Execution({"connections": {"devbox": {"origin": origin}}})


@pytest.fixture
def source(tmp_path):
    directory = tmp_path / "source"
    directory.mkdir()
    run_git(directory, "init", "-b", "master")
    (directory / "README.md").write_text("original\n", encoding="utf-8", newline="\n")
    run_git(directory, "add", "README.md")
    run_git(directory, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base")
    return directory


def test_private_worktree_and_immutable_review(plugin, source, tmp_path):
    from repoflow_repository_tasks.git_tasks import Repository, capture, prepare

    repo = Repository(source, "master", "origin", None)
    base = repo.base()
    private, workspace = tmp_path / "private.git", tmp_path / "repo"
    prepare(repo, private, workspace, base)
    assert not (workspace / ".git").exists()
    (workspace / "README.md").write_text("reviewed\n", encoding="utf-8", newline="\n")
    (workspace / "new.txt").write_text("new file\n", encoding="utf-8", newline="\n")
    result = capture(private, workspace, base, "Review an isolated change")
    (workspace / "README.md").write_text("later write\n", encoding="utf-8", newline="\n")
    assert "+reviewed" in result["diff"] and "+new file" in result["diff"]
    assert result["commit"] and run_git(private, "show", f"{result['commit']}:README.md") == "reviewed"
    assert run_git(source, "status", "--porcelain") == ""
    assert run_git(source, "rev-parse", "HEAD") == base


@pytest.mark.asyncio
async def test_session_confirmation_publishes_reviewed_snapshot_and_only_its_branch(plugin, source, tmp_path):
    from repoflow_repository_tasks.git_tasks import Repository, capture, prepare

    class Runs:
        async def get(self, **kwargs):
            return SimpleNamespace(status="success")

    destination = tmp_path / "destination.git"
    run_git(source, "clone", "--bare", str(source), str(destination))
    tasks = plugin.Tasks({"storage_path": str(tmp_path / "store"), "repositories": {}})
    task_id = str(uuid4())
    branch = f"repoflow/{task_id}"
    folder = tasks.root / task_id
    folder.mkdir()
    private, workspace = folder / "git", tmp_path / "repo"
    repo = Repository(source, "master", "origin", None)
    base = repo.base()
    prepare(repo, private, workspace, base)
    (workspace / "README.md").write_text("reviewed\n", encoding="utf-8", newline="\n")
    changes = capture(private, workspace, base, "Update docs")
    (workspace / "README.md").write_text("later write\n", encoding="utf-8", newline="\n")
    plugin.save(
        folder / "task.json",
        {
            "owner": "owner",
            "thread": task_id,
            "run": "run",
            "branch": branch,
            "base_branch": "master",
            "fork": "owner/repo",
            "target": "upstream/repo",
            "remote": str(destination),
            "title": "Update docs",
            "report": "Tests passed.",
            **changes,
        },
    )
    context = SimpleNamespace(principal=SimpleNamespace(is_admin=True, user_id="owner"), agent_runs=Runs(), interaction="session")
    payload = {"id": task_id, "commit": changes["commit"]}
    publish = tasks.action("push")
    result = await publish(payload, context)
    assert result == await publish(payload, context)
    assert result["pr_url"].startswith("https://github.com/upstream/repo/compare/master...owner:")
    assert run_git(destination, "show", f"refs/heads/{branch}:README.md") == "reviewed"
    assert run_git(destination, "rev-parse", f"refs/heads/{branch}") == changes["commit"]
    assert run_git(destination, "rev-parse", "refs/heads/master") == base
    assert run_git(destination, "for-each-ref", "--format=%(refname)") == f"refs/heads/master\nrefs/heads/{branch}"


@pytest.mark.asyncio
async def test_model_and_wrong_review_cannot_push(plugin, tmp_path):
    class Runs:
        async def get(self, **kwargs):
            return SimpleNamespace(status="success")

    tasks = plugin.Tasks({"storage_path": str(tmp_path / "store"), "repositories": {}})
    task_id = str(uuid4())
    plugin.save(tasks.root / task_id / "task.json", {"owner": "owner", "thread": task_id, "run": "run", "commit": "authorized-snapshot"})
    principal = SimpleNamespace(is_admin=True, user_id="owner")
    push = tasks.action("push")
    with pytest.raises(AgentRunError) as error:
        await push({"id": task_id, "commit": "authorized-snapshot"}, SimpleNamespace(principal=principal, agent_runs=Runs(), interaction="other"))
    assert error.value.status_code == 403
    with pytest.raises(AgentRunError) as error:
        await push({"id": task_id, "commit": "changed-snapshot"}, SimpleNamespace(principal=principal, agent_runs=Runs(), interaction="session"))
    assert error.value.status_code == 409


def test_prefilled_pr_targets_upstream(plugin):
    from urllib.parse import parse_qs, urlsplit

    from repoflow_repository_tasks.git_tasks import compare_url

    url = urlsplit(compare_url("original/repo", "user/fork", "master", "repoflow/task", "Fix docs", "Tests passed."))
    assert (url.netloc, url.path) == ("github.com", "/original/repo/compare/master...user:repoflow%2Ftask")
    assert parse_qs(url.query) == {"quick_pull": ["1"], "title": ["Fix docs"], "body": ["Tests passed."]}


@pytest.mark.asyncio
@pytest.mark.parametrize("custom_directory", [False, True])
async def test_prepare_clones_fork_and_uses_upstream_default_branch(plugin, github_metadata, source, tmp_path, monkeypatch, custom_directory):
    from repoflow_repository_tasks import git_tasks

    upstream = tmp_path / "upstream"
    run_git(source, "clone", str(source), str(upstream))
    run_git(upstream, "branch", "-m", "release")
    fork_url = "https://github.com/owner/fork.git"
    upstream_url = "https://github.com/project/original.git"
    actual_git = git_tasks.git
    clone_calls = []

    def transport(*args, network=False, **kwargs):
        if network:
            if args[0] == "clone":
                clone_calls.append(args)
            args = (
                "-c",
                f"url.{source.as_uri()}.insteadOf={fork_url}",
                "-c",
                f"url.{upstream.as_uri()}.insteadOf={upstream_url}",
                *args,
            )
        return actual_git(*args, network=network, **kwargs)

    monkeypatch.setattr(git_tasks, "git", transport)
    tasks = plugin.Tasks({"storage_path": str(tmp_path / "store")})

    def browser(user):
        return SimpleNamespace(
            principal=SimpleNamespace(is_admin=True, user_id=user),
            agent_runs=object(),
            interaction="session",
        )

    import_checkout = tasks.action("import")
    payload = {"url": fork_url, "upstream_url": upstream_url}
    destination = tmp_path / "managed-parent"
    destination.mkdir()
    unrelated = destination / "existing-project.txt"
    unrelated.write_text("other project\n", encoding="utf-8")
    if custom_directory:
        payload["clone_directory"] = str(destination)
    context = browser("owner")
    item = await import_checkout(payload, context)
    assert item == {"id": "owner/fork → project/original", "base": None}
    assert await import_checkout(payload, context) == item
    assert not clone_calls
    saved = {**item, "fork": "owner/fork", "target": "project/original"}
    assert await tasks.action("repositories")({}, context) == [saved]
    assert await tasks.action("repositories")({}, browser("other-admin")) == []
    with pytest.raises(AgentRunError) as rejected:
        await import_checkout({"url": "https://github.com.example/owner/fork"}, context)
    assert rejected.value.status_code == 422
    assert not clone_calls

    class Runs:
        async def create_thread(self, *, thread_id):
            (tmp_path / "workspaces" / thread_id).mkdir(parents=True, exist_ok=True)

        @asynccontextmanager
        async def reserve_local_workspace(self, *, thread_id):
            yield tmp_path / "workspaces" / thread_id

    context.agent_runs = Runs()
    reloaded = plugin.Tasks({"storage_path": str(tasks.root)})
    assert await reloaded.action("repositories")({}, context) == [saved]
    attach = reloaded.action("attach")
    first_id = str(uuid4())
    second_id = str(uuid4())
    first = await attach({"id": first_id, "repository": saved["id"]}, context)
    first_file = tmp_path / "workspaces" / first_id / "repo" / "README.md"
    assert first["base"] is None and not first_file.exists() and not clone_calls
    assert await reloaded.action("prepare")({"id": first_id}, context) == {"prepared": True}
    first = await reloaded.action("current")({"id": first_id}, context)
    repo = reloaded.available("owner")[item["id"]]
    assert repo.base() == run_git(upstream, "rev-parse", "refs/heads/release")
    assert repo.registration() == (fork_url, "owner/fork", "project/original")
    if custom_directory:
        assert repo.path.is_relative_to(destination / ".repoflow-clones")
    else:
        assert repo.path.is_relative_to(tasks.root / "imports")
    first_file.write_text("first conversation only\n", encoding="utf-8", newline="\n")
    second = await attach({"id": second_id, "repository": saved["id"]}, context)
    assert second["base"] is None and len(clone_calls) == 1
    assert await reloaded.action("prepare")({"id": second_id}, context) == {"prepared": True}
    assert await reloaded.action("prepare")({"id": second_id}, context) == {"prepared": False}
    second = await reloaded.action("current")({"id": second_id}, context)
    assert first["branch"] == f"repoflow/{first_id}"
    assert second["branch"] == f"repoflow/{second_id}"
    assert second["target"] == "project/original"
    assert second["base_branch"] == "release"
    assert (tmp_path / "workspaces" / second_id / "repo" / "README.md").read_text(encoding="utf-8") == "original\n"
    assert first_file.read_text(encoding="utf-8") == "first conversation only\n"
    assert len(clone_calls) == 1

    with pytest.raises(AgentRunError) as foreign:
        await reloaded.action("remove")({"repository": saved["id"]}, browser("other-admin"))
    assert foreign.value.status_code == 404
    removed = {"id": saved["id"], "has_checkout": True}
    assert await reloaded.action("remove")({"repository": saved["id"]}, context) == removed
    assert await reloaded.action("remove")({"repository": saved["id"]}, context) == removed

    after_removal = plugin.Tasks({"storage_path": str(tasks.root)})
    assert await after_removal.action("repositories")({}, context) == []
    assert await after_removal.action("current")({"id": first_id}, context) == first
    assert await after_removal.action("clones")({}, context) == [{"id": item["id"], "path": str(repo.path), "removed": True}]
    with pytest.raises(AgentRunError):
        await after_removal.action("purge-clone")({"repository": saved["id"]}, browser("other-admin"))
    assert repo.path.is_dir()
    await after_removal.action("purge-clone")({"repository": saved["id"]}, context)
    assert not repo.path.exists()
    assert unrelated.read_text(encoding="utf-8") == "other project\n"
    assert first_file.read_text(encoding="utf-8") == "first conversation only\n"
    with pytest.raises(AgentRunError) as hidden:
        await after_removal.action("attach")({"id": str(uuid4()), "repository": saved["id"]}, context)
    assert hidden.value.status_code == 422
    assert await after_removal.action("import")(payload, context) == {**item, "base": "release"}
    assert await after_removal.action("repositories")({}, context) == [{**saved, "base": "release"}]
    assert len(clone_calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("block_content", [False, True])
async def test_default_agent_introduces_itself_as_repoflow_without_an_attached_repo(plugin, block_content):
    from langchain.agents.middleware.types import ModelRequest
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from langchain_core.messages import SystemMessage
    from langgraph.runtime import Runtime
    from repoflow_repository_tasks.agent_context import RepositoryContext

    default_role = "<role>\nYou are DeerFlow 2.0, an open-source super agent.\n</role>"
    rendered = f"{default_role}\nKeep the normal Agent instructions."
    cache_control = {"type": "ephemeral"}
    content = [{"type": "text", "text": rendered, "cache_control": cache_control}] if block_content else rendered
    original = SystemMessage(content=content)
    request = ModelRequest(
        model=FakeListChatModel(responses=["unused"]),
        messages=[],
        system_message=original,
        runtime=Runtime(context={}),
    )

    async def received(request):
        return request.system_message

    middleware = RepositoryContext()
    message = await middleware.awrap_model_call(request, received)
    text = message.content[0]["text"] if block_content else message.content
    assert "You are RepoFlow, a general-purpose AI assistant" in text
    assert "writing, data analysis, and coding" in text
    assert "specialized support for GitHub repositories" in text
    assert "Keep the normal Agent instructions." in text
    assert "DeerFlow" not in text
    assert "/mnt/user-data/workspace/repo" not in text
    if block_content:
        assert message.content[0]["cache_control"] == cache_control
    assert original.content == content

    custom = SystemMessage(content=rendered.replace("DeerFlow 2.0", "Docs Writer"))
    result = await middleware.awrap_model_call(request.override(system_message=custom), received)
    assert result is custom


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("base_url", "model_id"),
    [("https://api.deepseek.com", "deepseek-flash"), ("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus")],
    ids=["deepseek", "qwen"],
)
async def test_repository_context_goes_only_to_the_attached_conversation(plugin, tmp_path, base_url, model_id):
    from deerflow_extension_api.runtime_bridge import EXTENSION_TASK_STORE_KEY
    from deerflow_extension_api.state import ExtensionData
    from langchain.agents import create_agent
    from langchain_core.messages import HumanMessage
    from repoflow_repository_tasks.agent_context import RepositoryContext

    from deerflow.models.patched_deepseek import PatchedChatDeepSeek

    tasks = plugin.Tasks({"storage_path": str(tmp_path / "store")})
    thread_id = str(uuid4())
    plugin.save(tasks.root / thread_id / "task.json", {"thread": thread_id, "base": "prepared"})
    prompt = "Keep the normal Agent instructions."
    requests = []

    def respond(request):
        assert request.url == httpx.URL(f"{base_url}/chat/completions")
        system = json.loads(request.content)["messages"][0]
        requests.append(system)
        if not isinstance(system["content"], str):
            return httpx.Response(422, json={"error": {"message": "System message must be a string", "type": "invalid_request_error"}})
        return httpx.Response(
            200,
            json={
                "id": "chat-test",
                "object": "chat.completion",
                "created": 1,
                "model": model_id,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "Offline reply"}, "finish_reason": "stop"}],
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        model = PatchedChatDeepSeek(model=model_id, api_base=base_url, api_key="offline-test-key", max_retries=0, http_async_client=client)
        graph = create_agent(model=model, system_prompt=prompt, middleware=[RepositoryContext()])

        for thread, attached in ((str(uuid4()), False), (thread_id, True)):
            store = ExtensionData(thread)
            await tasks.on_task_start(ExtensionData("app"), store, SimpleNamespace(thread_id=thread, run_id="context-run"))
            result = await graph.ainvoke({"messages": [HumanMessage(content="Hello")]}, context={EXTENSION_TASK_STORE_KEY: store})

            assert result["messages"][-1].content == "Offline reply"
            system = requests[-1]
            assert system["role"] == "system"
            assert system["content"].startswith(prompt)
            assert ("/mnt/user-data/workspace/repo" in system["content"]) is attached

    assert len(requests) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("existing_chat", [False, True])
async def test_compiled_default_agent_passes_repoflow_identity_to_model(plugin, tmp_path, monkeypatch, existing_chat):
    from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
    from pydantic import PrivateAttr

    from deerflow.agents.lead_agent import agent
    from deerflow.config.app_config import AppConfig
    from deerflow.config.extensions_config import ExtensionsConfig
    from deerflow.config.memory_config import MemoryConfig
    from deerflow.config.model_config import ModelConfig
    from deerflow.config.sandbox_config import SandboxConfig
    from deerflow.config.summarization_config import SummarizationConfig
    from deerflow.extensions import bind_agent_build_extensions
    from deerflow.extensions.registry import ExtensionRegistry

    class ProviderStub(FakeMessagesListChatModel):
        _requests = PrivateAttr(default_factory=list)

        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            self._requests.append(messages)
            return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    config_file = tmp_path / "config.yaml"
    config_file.write_text("sandbox:\n  use: deerflow.sandbox.local:LocalSandboxProvider\nmemory:\n  enabled: false\n", encoding="utf-8")
    monkeypatch.setenv("DEER_FLOW_CONFIG_PATH", str(config_file))
    monkeypatch.setenv("DEER_FLOW_HOME", str(tmp_path / "home"))
    config = AppConfig(
        models=[ModelConfig(name="identity-test", display_name="Identity test", description=None, use="langchain_openai:ChatOpenAI", model="identity-test", supports_thinking=False, supports_vision=False)],
        sandbox=SandboxConfig(use="deerflow.sandbox.local:LocalSandboxProvider"),
        memory=MemoryConfig(enabled=False),
        summarization=SummarizationConfig(enabled=False),
        extensions=ExtensionsConfig(middlewares=["repoflow_repository_tasks.agent_context:RepositoryContext"]),
    )
    provider = ProviderStub(responses=[AIMessage(content="Offline provider response")])
    monkeypatch.setattr(agent, "create_chat_model", lambda **kwargs: provider)
    registry = ExtensionRegistry()
    with registry.attributed_to("repoflow-repository-tasks"):
        plugin.install(registry, {"storage_path": str(tmp_path / "repos")})

    thread = str(uuid4())
    run = str(uuid4())
    runtime = {"thread_id": thread, "run_id": run}
    config_for_run = {"configurable": runtime, "context": runtime}
    history = [HumanMessage(content="你是谁？"), AIMessage(content="我是 DeerFlow 2.0。")] if existing_chat else []
    with bind_agent_build_extensions(registry.build()):
        assembled = agent.assemble_lead_agent(config_for_run, app_config=config)
        await assembled.graph.ainvoke({"messages": [*history, HumanMessage(content="你好，你是谁？")]}, config=config_for_run, context=runtime)

    assert len(provider._requests) == 1
    system = "\n".join(block["text"] for message in provider._requests[0] if isinstance(message, SystemMessage) for block in message.content_blocks if block.get("type") == "text")
    assert "You are RepoFlow, a general-purpose AI assistant" in system
    assert "specialized support for GitHub repositories" in system
    assert "Introduce yourself as RepoFlow" in system
    assert "You are DeerFlow" not in system
