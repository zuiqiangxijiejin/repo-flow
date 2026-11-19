"""Personal GitHub connections through plugin actions and real HTTP clients."""

import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from deerflow.config.credentials_key import CredentialsCipher

PACKAGE = Path(__file__).resolve().parents[2] / "examples/deerflow-extension-repository-tasks"
KEY = "github_pat_offline_test_credential"


def session(user_id="alice", *, interaction="session"):
    return SimpleNamespace(principal=SimpleNamespace(user_id=user_id, is_admin=False), interaction=interaction, agent_runs=None)


@pytest.fixture
def accounts(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(PACKAGE))
    import repoflow_repository_tasks as plugin
    from repoflow_repository_tasks import accounts as module

    cipher = CredentialsCipher.from_keys([base64.urlsafe_b64encode(b"a" * 32)])
    monkeypatch.setattr(module.GitHubAccounts, "_cipher", lambda self: cipher)
    tasks = plugin.Tasks({"storage_path": str(tmp_path / "tasks")})
    return tasks


@pytest.fixture
def github(monkeypatch):
    from repoflow_repository_tasks import accounts as module

    requests = []
    client_class = httpx.AsyncClient

    def respond(request):
        requests.append(request)
        assert request.url.host == "api.github.com"
        token = request.headers["Authorization"]
        if token == "Bearer revoked_token":
            return httpx.Response(401, json={"message": "Provider echoed revoked_token"})
        login = "bob" if token == "Bearer bob_personal_token" else "alice"
        if request.url.path == "/user":
            return httpx.Response(200, json={"id": 123 if login == "alice" else 456, "login": login, "name": login.title()})
        if request.url.path == "/user/repos":
            return httpx.Response(200, json=[{"full_name": f"{login}/private", "private": True, "permissions": {"push": True}}])
        if request.url.path.startswith("/repos/"):
            return httpx.Response(200, json={"full_name": request.url.path[7:], "permissions": {"push": login == "alice"}})
        raise AssertionError(request.url)

    def client(**kwargs):
        return client_class(transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr(module.httpx, "AsyncClient", client)
    return requests


@pytest.mark.asyncio
async def test_personal_token_is_verified_encrypted_and_scoped(accounts, github):
    result = await accounts.action("github-token")({"token": KEY, "user_id": "bob"}, session())
    assert result["connected"] is True
    assert result["account"]["login"] == "alice"
    assert KEY not in json.dumps(result)
    assert KEY.encode() not in accounts.accounts._path("alice").read_bytes()
    assert accounts.accounts._path("alice").stat().st_mode & 0o777 == 0o600
    assert (await accounts.action("github-status")({}, session("bob")))["connected"] is False
    await accounts.action("github-token")({"token": "bob_personal_token"}, session("bob"))
    repositories = await accounts.action("github-repositories")({}, session("bob"))
    assert repositories["repositories"][0]["name"] == "bob/private"
    await accounts.action("github-disconnect")({}, session())
    assert (await accounts.accounts.credentials("alice")) is None
    assert (await accounts.accounts.credentials("bob"))["token"] == "bob_personal_token"
    assert all(request.method == "GET" for request in github)


@pytest.mark.asyncio
async def test_invalid_token_preserves_connection_and_redacts_provider_error(accounts, github):
    from deerflow_extension_api.agent_runs import AgentRunError

    await accounts.action("github-token")({"token": KEY}, session())
    with pytest.raises(AgentRunError) as failure:
        await accounts.action("github-token")({"token": "revoked_token"}, session())
    assert failure.value.status_code == 403
    assert "revoked_token" not in str(failure.value)
    assert (await accounts.accounts.credentials("alice"))["token"] == KEY


@pytest.mark.asyncio
async def test_model_callers_cannot_manage_credentials(accounts, github):
    from deerflow_extension_api.agent_runs import AgentRunError

    for action in ("github-status", "github-token", "github-login", "github-disconnect"):
        with pytest.raises(AgentRunError) as failure:
            await accounts.action(action)({"token": KEY}, session(interaction="other"))
        assert failure.value.status_code == 403
    assert github == []


@pytest.mark.asyncio
async def test_write_permission_is_checked_with_the_current_users_token(accounts, github):
    from deerflow_extension_api.agent_runs import AgentRunError

    await accounts.action("github-token")({"token": KEY}, session())
    await accounts.action("github-token")({"token": "bob_personal_token"}, session("bob"))
    await accounts.accounts.repository("alice", "alice/private", require_push=True)
    with pytest.raises(AgentRunError) as failure:
        await accounts.accounts.repository("bob", "alice/private", require_push=True)
    assert failure.value.status_code == 403
    assert github[-1].headers["Authorization"] == "Bearer bob_personal_token"


@pytest.mark.asyncio
@pytest.mark.skipif(os.name != "posix", reason="The fake GitHub CLI uses an executable script")
@pytest.mark.parametrize("cancel", [False, True])
async def test_browser_login_uses_private_cli_configuration_and_removes_plaintext(accounts, github, tmp_path, monkeypatch, cancel):
    from repoflow_repository_tasks import accounts as module

    executable = tmp_path / "gh"
    gate = tmp_path / "approved"
    config_path = tmp_path / "cli-directory"
    executable.write_text(
        f"#!{sys.executable}\n"
        "import os, pathlib, sys, time\n"
        "assert 'GH_TOKEN' not in os.environ and 'GITHUB_TOKEN' not in os.environ\n"
        "folder=pathlib.Path(os.environ['GH_CONFIG_DIR'])\n"
        f"pathlib.Path({str(config_path)!r}).write_text(str(folder))\n"
        "if sys.argv[1:3] == ['auth','login']:\n"
        "    print('! First copy your one-time code: ABCD-1234',flush=True)\n"
        f"    while not pathlib.Path({str(gate)!r}).exists(): time.sleep(0.01)\n"
        f"    (folder/'hosts.yml').write_text({KEY!r})\n"
        "else:\n"
        "    print((folder/'hosts.yml').read_text())\n"
    )
    executable.chmod(0o700)
    monkeypatch.setenv("GH_TOKEN", "operator-token-that-must-not-be-used")
    monkeypatch.setenv("GITHUB_TOKEN", "another-operator-token")
    monkeypatch.setattr(module.shutil, "which", lambda name: str(executable))
    try:
        first = await accounts.action("github-login")({}, session())
        assert first["authorization"]["state"] == "starting"
        async with asyncio.timeout(8):
            while accounts.accounts.attempts["alice"].state != "pending":
                await asyncio.sleep(0.01)
        waiting = await accounts.action("github-status")({}, session())
        assert waiting["authorization"]["code"] == "ABCD-1234"
        assert (await accounts.action("github-status")({}, session("bob")))["authorization"] is None
        if cancel:
            disconnected = await accounts.action("github-cancel")({}, session())
            assert disconnected["authorization"] is None
            assert disconnected["connected"] is False
            assert not Path(config_path.read_text()).exists()
            assert github == []
            return
        gate.touch()
        await asyncio.wait_for(accounts.accounts.attempts["alice"].task, timeout=8)
        connected = await accounts.action("github-status")({}, session())
        assert connected["account"]["login"] == "alice"
        assert connected["authorization"]["state"] == "connected"
        assert not Path(config_path.read_text()).exists()
        assert KEY not in json.dumps(connected)
    finally:
        await accounts.accounts.stop()


def test_git_push_receives_the_personal_token_only_through_its_environment(accounts, monkeypatch):
    from repoflow_repository_tasks import git_tasks

    captured = []

    def run(command, **options):
        captured.append((command, options))

    monkeypatch.setattr(git_tasks.subprocess, "run", run)
    monkeypatch.setenv("GIT_CONFIG_COUNT", "1")
    monkeypatch.setenv("GIT_CONFIG_KEY_0", "http.extraheader")
    monkeypatch.setenv("GIT_CONFIG_VALUE_0", "operator credential")
    git_tasks.publish(Path("private.git"), "https://github.com/alice/fork", "a" * 40, "repoflow/test", token=KEY)
    command, options = captured[0]
    assert KEY not in " ".join(map(str, command))
    assert options["env"]["GIT_CONFIG_GLOBAL"] == os.devnull
    assert options["env"]["GIT_CONFIG_VALUE_0"] == ""


@pytest.mark.asyncio
@pytest.mark.parametrize("owner,allowed", [("alice", True), ("bob", False), ("unconnected", False)])
async def test_reviewed_push_uses_the_owners_account(accounts, github, monkeypatch, owner, allowed):
    from uuid import uuid4

    from deerflow_extension_api.agent_runs import AgentRunError
    from repoflow_repository_tasks import git_tasks, save

    if owner != "unconnected":
        await accounts.action("github-token")({"token": KEY if owner == "alice" else "bob_personal_token"}, session(owner))
    task_id = str(uuid4())
    commit = "a" * 40
    folder = accounts.root / task_id
    save(
        folder / "task.json",
        {
            "owner": owner,
            "thread": task_id,
            "repository": "alice/fork → upstream/repo",
            "fork": "alice/fork",
            "target": "upstream/repo",
            "remote": "git@github.com:alice/fork.git",
            "commit": commit,
            "commit_author": await accounts.accounts.commit_identity(owner),
            "base_branch": "main",
            "branch": f"repoflow/{task_id}",
            "title": "Reviewed fix",
            "report": "Description",
        },
    )
    pushes = []

    def transport(command, **options):
        pushes.append((command, options))

    monkeypatch.setattr(git_tasks.subprocess, "run", transport)
    context = session(owner)
    context.principal.is_admin = True
    context.agent_runs = object()
    operation = accounts.action("push")
    if not allowed:
        with pytest.raises(AgentRunError) as denied:
            await operation({"id": task_id, "commit": commit}, context)
        assert denied.value.status_code == (403 if owner == "bob" else 409)
        assert pushes == []
        return
    result = await operation({"id": task_id, "commit": commit}, context)
    assert result["pr_url"].startswith("https://github.com/upstream/repo/compare/")
    assert len(pushes) == 1
    command, options = pushes[0]
    assert "https://github.com/alice/fork.git" in command
    assert f"refs/repoflow/reviews/{commit}:refs/heads/repoflow/{task_id}" in command
    assert KEY not in " ".join(command)
    assert options["env"]["GIT_CONFIG_VALUE_1"].startswith("AUTHORIZATION: basic ")
    assert github[-1].headers["Authorization"] == f"Bearer {KEY}"
    encoded = options["env"]["GIT_CONFIG_VALUE_1"].removeprefix("AUTHORIZATION: basic ")
    assert base64.b64decode(encoded).decode() == f"x-access-token:{KEY}"
    assert "operator credential" not in options["env"].values()
