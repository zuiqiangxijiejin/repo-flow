"""SSH profiles exercise encryption, account isolation and the subprocess boundary."""

import base64
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from deerflow_extension_api.agent_runs import AgentRunError

pytestmark = pytest.mark.skipif(os.name != "posix", reason="SSH host transport requires POSIX")


@pytest.fixture
def ssh(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "examples/deerflow-extension-repository-tasks"))
    monkeypatch.setenv("DEER_FLOW_CREDENTIALS_KEY", "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=")
    from repoflow_repository_tasks import Tasks

    tasks = Tasks({"storage_path": str(tmp_path / "tasks"), "execution": {"connections": {"operator": {"origin": "https://operator.example.test"}}}})
    algorithm = b"ssh-ed25519"
    blob = len(algorithm).to_bytes(4, "big") + algorithm + (32).to_bytes(4, "big") + b"a" * 32
    payload = {
        "name": "My host",
        "address": "dev.example.test",
        "port": 2222,
        "username": "alice",
        "auth_type": "password",
        "secret": "offline-test-password",
        "origin": "https://remote.example.test",
        "host_keys": "[dev.example.test]:2222 ssh-ed25519 " + base64.b64encode(blob).decode() + "\n",
        "trust_host": True,
    }
    context = SimpleNamespace(principal=SimpleNamespace(user_id="alice", is_admin=False), interaction="session", agent_runs=object())
    return SimpleNamespace(tasks=tasks, hosts=tasks.ssh, payload=payload, context=context)


def test_ssh_profiles_encrypt_credentials_and_enforce_ownership(ssh):
    s = ssh
    saved = s.hosts.save("alice", s.payload)
    assert "secret" not in saved and "host_keys" not in saved
    raw = s.hosts.path("alice", saved["id"]).read_text()
    assert s.payload["secret"] not in raw and s.payload["address"] not in raw
    assert s.hosts.path("alice", saved["id"]).stat().st_mode & 0o777 == 0o600
    assert s.hosts.list("bob") == []
    with pytest.raises(AgentRunError) as foreign:
        s.hosts.execute("bob", saved["id"])
    assert foreign.value.status_code == 404
    edited = s.hosts.save("alice", {key: value for key, value in {**s.payload, "id": saved["id"], "name": "Renamed"}.items() if key not in {"secret", "host_keys", "trust_host"}})
    assert edited["name"] == "Renamed" and s.hosts.read("alice", saved["id"])["secret"] == s.payload["secret"]
    assert s.hosts.action("ssh-delete", "alice", {"id": saved["id"]}) == {"deleted": True}
    assert s.hosts.list("alice") == []


def test_ssh_test_does_not_require_an_installed_remote_app(ssh, monkeypatch):
    from repoflow_repository_tasks import ssh_hosts

    saved = ssh.hosts.save("alice", {**ssh.payload, "origin": ""})
    attempts = []
    monkeypatch.setattr(ssh_hosts.subprocess, "run", lambda args, **kwargs: attempts.append(args))
    assert ssh.hosts.execute("alice", saved["id"])["connected"]
    assert attempts[0][-1] == "true"
    with pytest.raises(AgentRunError) as missing_app:
        ssh.hosts.execute("alice", saved["id"], connect=True)
    assert missing_app.value.status_code == 422 and len(attempts) == 1


@pytest.mark.parametrize(
    "fields",
    [
        {"trust_host": False},
        {"address": "--proxy-command=bad"},
        {"address": "host;bad"},
        {"port": True},
        {"username": "alice;bad"},
        {"service": "repoflow.target;bad"},
        {"origin": "https://remote.example.test/path"},
        {"host_keys": "wrong ssh-ed25519 aaaa"},
    ],
)
def test_ssh_requires_trusted_fingerprint_and_rejects_command_injection(ssh, fields):
    with pytest.raises(AgentRunError) as denied:
        ssh.hosts.save("alice", {**ssh.payload, **fields})
    assert denied.value.status_code == 422
    assert ssh.hosts.list("alice") == []


@pytest.mark.parametrize("kind", ["key", "password"])
def test_ssh_uses_only_pinned_keys_and_own_credentials(ssh, monkeypatch, kind):
    from repoflow_repository_tasks import ssh_hosts

    payload = {**ssh.payload, "auth_type": kind}
    if kind == "key":
        payload["secret"] = "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----"
    saved = ssh.hosts.save("alice", payload)
    monkeypatch.setenv("SSH_AUTH_SOCK", "/operator/agent")
    seen = []

    def run(args, **kwargs):
        assert "-F" in args and "/dev/null" in args
        assert "StrictHostKeyChecking=yes" in args and "IdentityAgent=none" in args
        assert "SSH_AUTH_SOCK" not in kwargs["env"]
        known = Path(next(arg.split("=", 1)[1] for arg in args if arg.startswith("UserKnownHostsFile=")))
        assert known.read_text() == payload["host_keys"]
        assert args[-2] == payload["address"] and "systemctl --user start repoflow.target" in args[-1]
        assert payload["secret"] not in repr(args)
        if kind == "key":
            key = Path(args[args.index("-i") + 1])
            assert key.read_text().strip() == payload["secret"]
            assert key.stat().st_mode & 0o777 == 0o600
        else:
            assert kwargs["env"]["REPOFLOW_SSH_SECRET"] == payload["secret"]
            assert kwargs["env"]["SSH_ASKPASS_REQUIRE"] == "force"
            assert "PubkeyAuthentication=no" in args
        seen.append(known.parent)
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(ssh_hosts.subprocess, "run", run)
    assert ssh.hosts.execute("alice", saved["id"], connect=True)["connected"]
    assert len(seen) == 1 and not seen[0].exists()


@pytest.mark.asyncio
async def test_normal_user_can_manage_own_hosts_but_not_operator_connections(ssh, monkeypatch):
    from repoflow_repository_tasks import ssh_hosts

    s = ssh
    saved = await s.tasks.action("ssh-save")(s.payload, s.context)
    view = await s.tasks.action("execution")({}, s.context)
    assert view["hosts"] == [saved["id"]] and view["profiles"] == [saved]
    monkeypatch.setattr(ssh_hosts.subprocess, "run", lambda *args, **kwargs: None)
    assert (await s.tasks.action("connect")({"host": saved["id"]}, s.context))["connected"]
    with pytest.raises(AgentRunError) as denied:
        await s.tasks.action("connect")({"host": "operator"}, s.context)
    assert denied.value.status_code == 404
    s.context.principal.user_id = "bob"
    assert (await s.tasks.action("execution")({}, s.context))["hosts"] == []
    with pytest.raises(AgentRunError):
        await s.tasks.action("ssh-test")({"id": saved["id"]}, s.context)
    s.context.interaction = "tool"
    with pytest.raises(AgentRunError) as model:
        await s.tasks.action("ssh-save")(s.payload, s.context)
    assert model.value.status_code == 403
