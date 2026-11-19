"""Account-owned SSH profiles with encrypted secrets and pinned host keys."""

import base64
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

from deerflow_extension_api.agent_runs import AgentRunError

from .execution import _SERVICE, web_origin


class SSHHosts:
    def __init__(self, root, cipher):
        self.root, self.cipher = root / "ssh-accounts", cipher

    def folder(self, owner):
        return self.root / hashlib.sha256(owner.encode()).hexdigest()

    def path(self, owner, identity):
        if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{32}", identity):
            raise AgentRunError(404, "SSH host unavailable.")
        return self.folder(owner) / (identity + ".json")

    def read(self, owner, identity):
        try:
            raw = self.path(owner, identity).read_text()
        except FileNotFoundError:
            raise AgentRunError(404, "SSH host unavailable.") from None
        try:
            data = json.loads(self.cipher().decrypt_text(raw))
            if data["owner"] != owner or data["id"] != identity:
                raise ValueError("Wrong owner")
            return data
        except Exception:
            raise AgentRunError(503, "SSH credentials cannot be read. Restore the connection or credentials key.") from None

    @staticmethod
    def public(data):
        return {key: data[key] for key in ("id", "name", "address", "port", "username", "auth_type", "origin", "service", "ready_port", "fingerprints")}

    def list(self, owner):
        folder = self.folder(owner)
        if not folder.exists():
            return []
        return [self.public(self.read(owner, path.stem)) for path in sorted(folder.glob("*.json"))]

    @staticmethod
    def address(payload):
        host, port = payload.get("address"), payload.get("port", 22)
        if not isinstance(host, str) or len(host) > 253 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.:-]*", host):
            raise AgentRunError(422, "Enter a hostname or IP address without SSH options.")
        if type(port) is not int or not 1 <= port <= 65535:
            raise AgentRunError(422, "Enter an SSH port between 1 and 65535.")
        return host, port

    @staticmethod
    def fingerprints(keys, host, port):
        valid = []
        for line in keys.splitlines():
            parts = line.split()
            if not parts or line.startswith("#"):
                continue
            if len(parts) != 3 or parts[0] not in {host, f"[{host}]:{port}"} or parts[1] not in {"ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"}:
                raise AgentRunError(422, "The host key does not match this SSH address.")
            try:
                blob = base64.b64decode(parts[2], validate=True)
            except ValueError:
                raise AgentRunError(422, "Invalid SSH host key.") from None
            algorithm = parts[1].encode()
            if len(blob) < 32 or blob[:4] != len(algorithm).to_bytes(4, "big") or blob[4 : 4 + len(algorithm)] != algorithm:
                raise AgentRunError(422, "Invalid SSH host key.")
            valid.append("SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("="))
        if not valid:
            raise AgentRunError(422, "Read and confirm the SSH host fingerprint first.")
        return valid

    def probe(self, payload):
        host, port = self.address(payload)
        try:
            result = subprocess.run(["ssh-keyscan", "-T", "5", "-p", str(port), "--", host], capture_output=True, text=True, check=True, timeout=12)
            keys = result.stdout[:32768]
            return {"host_keys": keys, "fingerprints": self.fingerprints(keys, host, port)}
        except (OSError, subprocess.SubprocessError):
            raise AgentRunError(502, "Could not read this host's SSH fingerprint. Check its address and port.") from None

    def save(self, owner, payload):
        from deerflow.utils.atomic_write import publish_bytes_atomically

        identity = payload.get("id") or uuid4().hex
        previous = self.read(owner, identity) if payload.get("id") else {}
        host, port = self.address(payload)
        name, username = payload.get("name"), payload.get("username")
        if not isinstance(name, str) or not name.strip() or len(name) > 80 or any(ord(c) < 32 for c in name):
            raise AgentRunError(422, "Enter a host name of up to 80 characters.")
        if not isinstance(username, str) or not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}", username):
            raise AgentRunError(422, "Enter a valid SSH username.")
        kind = payload.get("auth_type", "key")
        if kind not in {"key", "password"}:
            raise AgentRunError(422, "Choose private key or password authentication.")
        secret = payload.get("secret") or (previous.get("secret") if previous.get("auth_type") == kind else None)
        if not isinstance(secret, str) or not secret or len(secret) > 32768 or "\0" in secret:
            raise AgentRunError(422, "Enter your SSH private key or password.")
        if kind == "key" and "PRIVATE KEY-----" not in secret:
            raise AgentRunError(422, "Paste the complete SSH private key.")
        keys = payload.get("host_keys") or (previous.get("host_keys") if (host, port) == (previous.get("address"), previous.get("port")) else "")
        if not isinstance(keys, str) or len(keys) > 32768:
            raise AgentRunError(422, "Invalid SSH host keys.")
        fingerprints = self.fingerprints(keys, host, port)
        if keys != previous.get("host_keys") and payload.get("trust_host") is not True:
            raise AgentRunError(422, "Confirm the host fingerprint before saving.")
        service, ready_port = payload.get("service", "repoflow.target"), payload.get("ready_port", 12026)
        if not isinstance(service, str) or not _SERVICE.fullmatch(service) or type(ready_port) is not int or not 1 <= ready_port <= 65535:
            raise AgentRunError(422, "Enter a valid remote service and readiness port.")
        try:
            origin = web_origin(payload["origin"]) if payload.get("origin") else None
        except (ValueError, TypeError):
            raise AgentRunError(422, "Enter the remote RepoFlow HTTPS address, or a loopback HTTP address.") from None
        data = {
            "owner": owner,
            "id": identity,
            "name": name.strip(),
            "address": host,
            "port": port,
            "username": username,
            "auth_type": kind,
            "secret": secret,
            "origin": origin,
            "service": service,
            "ready_port": ready_port,
            "host_keys": keys,
            "fingerprints": fingerprints,
        }
        path = self.path(owner, identity)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        publish_bytes_atomically(path, self.cipher().encrypt_text(json.dumps(data)).encode())
        path.chmod(0o600)
        return self.public(data)

    def execute(self, owner, identity, *, connect=False):
        data = self.read(owner, identity)
        command = "true"
        if connect:
            if not data["origin"]:
                raise AgentRunError(422, "Configure the remote RepoFlow browser address before opening the remote app. SSH testing is available without it.")
            command = f"systemctl --user start {data['service']} && curl --fail --silent --retry 3 --retry-all-errors --retry-delay 1 --max-time 3 http://localhost:{data['ready_port']}/health/ready >/dev/null"
        with tempfile.TemporaryDirectory(prefix="repoflow-ssh-") as folder:
            folder = Path(folder)
            known = folder / "known_hosts"
            known.write_text(data["host_keys"])
            known.chmod(0o600)
            args = [
                "ssh",
                "-F",
                "/dev/null",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                f"UserKnownHostsFile={known}",
                "-o",
                "GlobalKnownHostsFile=/dev/null",
                "-o",
                "IdentityAgent=none",
                "-o",
                "IdentitiesOnly=yes",
                "-o",
                "ControlMaster=no",
                "-o",
                "ControlPath=none",
                "-o",
                "ClearAllForwardings=yes",
                "-o",
                "ConnectTimeout=6",
                "-p",
                str(data["port"]),
                "-l",
                data["username"],
            ]
            env = {key: value for key, value in os.environ.items() if key not in {"SSH_AUTH_SOCK", "SSH_ASKPASS", "SSH_ASKPASS_REQUIRE", "DISPLAY"}}
            if data["auth_type"] == "key":
                key = folder / "identity"
                key.write_text(data["secret"].rstrip() + "\n")
                key.chmod(0o600)
                args += ["-i", str(key), "-o", "BatchMode=yes"]
            else:
                helper = folder / "askpass"
                helper.write_text("#!/bin/sh\nprintf '%s' \"$REPOFLOW_SSH_SECRET\"\n")
                helper.chmod(0o700)
                env.update(SSH_ASKPASS=str(helper), SSH_ASKPASS_REQUIRE="force", DISPLAY="repoflow:0", REPOFLOW_SSH_SECRET=data["secret"])
                args += ["-o", "PubkeyAuthentication=no", "-o", "BatchMode=no", "-o", "NumberOfPasswordPrompts=1", "-o", "PreferredAuthentications=password,keyboard-interactive"]
            try:
                subprocess.run([*args, "--", data["address"], command], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=24)
            except (OSError, subprocess.SubprocessError):
                raise AgentRunError(502, "SSH connection failed. Verify the fingerprint, account credentials and remote service.") from None
        return {"host": identity, "origin": data["origin"], "connected": True}

    def action(self, name, owner, payload):
        if name == "ssh-list":
            return {"hosts": self.list(owner)}
        if name == "ssh-probe":
            return self.probe(payload)
        if name == "ssh-save":
            return self.save(owner, payload)
        if name == "ssh-delete":
            path = self.path(owner, payload.get("id"))
            self.read(owner, payload.get("id"))
            path.unlink()
            return {"deleted": True}
        if name == "ssh-test":
            return self.execute(owner, payload.get("id"))
        raise AgentRunError(404, "Unknown SSH action.")
