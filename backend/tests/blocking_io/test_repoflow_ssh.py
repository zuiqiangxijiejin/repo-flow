import os
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.mark.asyncio
@pytest.mark.skipif(os.name != "posix", reason="Repository plugin deploys on POSIX hosts")
async def test_ssh_action_runs_blocking_transport_offloop(tmp_path, monkeypatch):
    package = Path(__file__).resolve().parents[3] / "examples" / "deerflow-extension-repository-tasks"
    monkeypatch.syspath_prepend(str(package))
    from repoflow_repository_tasks import Tasks, execution

    tasks = Tasks(
        {
            "storage_path": str(tmp_path / "tasks"),
            "execution": {"connections": {"fixture": {"origin": "https://fixture.example.test"}}},
        }
    )
    fixture = tmp_path / "ready"
    fixture.write_text("ready", encoding="utf-8")
    loop_thread = threading.get_ident()
    attempts = []

    def run(args, **kwargs):
        assert threading.get_ident() != loop_thread
        assert fixture.read_text(encoding="utf-8") == "ready"
        attempts.append(args[-2])

    monkeypatch.setattr(execution.subprocess, "run", run)
    context = SimpleNamespace(
        principal=SimpleNamespace(is_admin=True, user_id="owner"),
        agent_runs=object(),
        interaction="session",
    )
    result = await tasks.action("connect")({"host": "fixture"}, context)
    assert result["origin"] == "https://fixture.example.test"
    assert attempts == ["fixture"]


@pytest.mark.asyncio
@pytest.mark.skipif(os.name != "posix", reason="SSH transport requires POSIX")
async def test_personal_ssh_actions_keep_files_crypto_and_processes_offloop(tmp_path, monkeypatch):
    import base64
    import subprocess

    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[3] / "examples/deerflow-extension-repository-tasks"))
    monkeypatch.setenv("DEER_FLOW_CREDENTIALS_KEY", "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=")
    from repoflow_repository_tasks import Tasks, ssh_hosts

    tasks = Tasks({"storage_path": str(tmp_path / "tasks")})
    algorithm = b"ssh-ed25519"
    key = len(algorithm).to_bytes(4, "big") + algorithm + (32).to_bytes(4, "big") + b"a" * 32
    host_keys = "dev.example.test ssh-ed25519 " + base64.b64encode(key).decode() + "\n"
    loop_thread = threading.get_ident()
    calls = []

    def run(args, **kwargs):
        assert threading.get_ident() != loop_thread
        calls.append(args[0])
        return subprocess.CompletedProcess(args, 0, stdout=host_keys)

    monkeypatch.setattr(ssh_hosts.subprocess, "run", run)
    context = SimpleNamespace(principal=SimpleNamespace(user_id="alice", is_admin=False), interaction="session", agent_runs=object())
    fields = {"address": "dev.example.test", "port": 22}
    probe = await tasks.action("ssh-probe")(fields, context)
    saved = await tasks.action("ssh-save")({**fields, **probe, "trust_host": True, "name": "Dev", "username": "alice", "auth_type": "password", "secret": "offline-password", "origin": "https://remote.example.test"}, context)
    assert (await tasks.action("execution")({}, context))["hosts"] == [saved["id"]]
    assert (await tasks.action("ssh-test")({"id": saved["id"]}, context))["connected"]
    assert (await tasks.action("connect")({"host": saved["id"]}, context))["connected"]
    assert await tasks.action("ssh-delete")({"id": saved["id"]}, context) == {"deleted": True}
    assert calls == ["ssh-keyscan", "ssh", "ssh"]


@pytest.mark.asyncio
@pytest.mark.skipif(os.name != "posix", reason="Repository plugin deploys on POSIX hosts")
async def test_repository_removal_records_preferences_offloop(tmp_path, monkeypatch):
    package = Path(__file__).resolve().parents[3] / "examples/deerflow-extension-repository-tasks"
    monkeypatch.syspath_prepend(str(package))
    import repoflow_repository_tasks as plugin

    tasks = plugin.Tasks(
        {
            "storage_path": str(tmp_path / "tasks"),
            "repositories": {"project": {"path": str(tmp_path), "branch": "main"}},
        }
    )
    loop_thread = threading.get_ident()
    record = plugin.save
    writes = []

    def save(path, data):
        assert threading.get_ident() != loop_thread
        record(path, data)
        writes.append(path)

    monkeypatch.setattr(plugin, "save", save)
    context = SimpleNamespace(
        principal=SimpleNamespace(is_admin=True, user_id="owner"),
        agent_runs=object(),
        interaction="session",
    )
    assert await tasks.action("remove")({"repository": "project"}, context) == {"id": "project", "has_checkout": False}
    assert len(writes) == 1
    assert await plugin.disk(writes[0].is_file)
    assert await tasks.action("repositories")({}, context) == []
    other = SimpleNamespace(**vars(context))
    other.principal = SimpleNamespace(is_admin=True, user_id="another-admin")
    assert await tasks.action("repositories")({}, other) == [{"id": "project", "base": "main"}]
