"""Personal GitHub credentials and browser authorization for repository tasks."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shlex
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

import httpx
from deerflow_extension_api.agent_runs import AgentRunError

_LOGIN = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}\Z")
_REPOSITORY = re.compile(r"[A-Za-z0-9-]+/[A-Za-z0-9_.-]+\Z")
_DEVICE_CODE = re.compile(r"\b[A-Z0-9]{4}-[A-Z0-9]{4}\b")


@dataclass
class LoginAttempt:
    id: str = field(default_factory=lambda: uuid4().hex)
    expires_at: float = field(default_factory=lambda: time.time() + 900)
    state: str = "starting"
    code: str = ""
    task: asyncio.Task | None = None

    def public(self):
        return {"id": self.id, "state": self.state, "code": self.code, "verification_uri": "https://github.com/login/device", "expires_at": self.expires_at}


class GitHubAccounts:
    def __init__(self, root: Path, disk):
        self.root = root / "github-accounts"
        self.disk = disk
        self.attempts: dict[str, LoginAttempt] = {}
        self.locks: dict[str, asyncio.Lock] = {}

    async def start(self, deps):
        pass

    async def stop(self):
        tasks = [attempt.task for attempt in self.attempts.values() if attempt.task and not attempt.task.done()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.attempts.clear()

    def _lock(self, user_id):
        return self.locks.setdefault(user_id, asyncio.Lock())

    def _path(self, user_id):
        return self.root / hashlib.sha256(user_id.encode()).hexdigest() / "connection.json"

    def _cipher(self):
        # Use the same encryption/key rotation implementation as the host.
        from deerflow.config.credentials_key import load_credentials_cipher

        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        return load_credentials_cipher(base_dir=self.root)

    def _read(self, user_id):
        try:
            raw = self._path(user_id).read_text()
        except FileNotFoundError:
            return None
        try:
            data = json.loads(self._cipher().decrypt_text(raw))
            if data["owner"] != user_id or not isinstance(data["token"], str) or not _LOGIN.fullmatch(data["account"]["login"]):
                raise ValueError("Invalid account record")
            return data
        except Exception:
            raise AgentRunError(503, "GitHub credentials are unavailable. Check the credentials key and restore the connection.") from None

    def _save(self, user_id, token, account):
        from deerflow.utils.atomic_write import publish_bytes_atomically

        encrypted = self._cipher().encrypt_text(json.dumps({"owner": user_id, "token": token, "account": account}))
        path = self._path(user_id)
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        publish_bytes_atomically(path, encrypted.encode())
        path.chmod(0o600)

    async def credentials(self, user_id):
        return await self.disk(self._read, user_id)

    async def commit_identity(self, user_id, *, credentials=None):
        data = credentials if credentials is not None else await self.credentials(user_id)
        if data is None:
            return None
        account = data["account"]
        account_id, login = account.get("id"), account.get("login")
        if isinstance(account_id, bool) or not isinstance(account_id, int) or account_id < 1 or not isinstance(login, str) or not _LOGIN.fullmatch(login):
            raise AgentRunError(503, "Reconnect GitHub to verify your commit identity.")
        return {"name": login, "email": f"{account_id}+{login}@users.noreply.github.com"}

    async def status(self, user_id):
        data = await self.credentials(user_id)
        attempt = self.attempts.get(user_id)
        return {"connected": data is not None, "account": data["account"] if data else None, "browser_available": await self.disk(shutil.which, "gh") is not None, "authorization": attempt.public() if attempt else None}

    async def _api(self, token, path, params=None, *, method="GET", body=None):
        try:
            async with httpx.AsyncClient(
                base_url="https://api.github.com", headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}, timeout=12, follow_redirects=False, trust_env=False
            ) as client:
                async with client.stream(method, path, params=params, json=body) as response:
                    if response.status_code in (401, 403):
                        raise AgentRunError(403, "GitHub authorization is invalid or lacks permission. Reconnect your account.")
                    if response.status_code == 404:
                        raise AgentRunError(404, "The connected GitHub account cannot access this repository.")
                    if response.status_code == 422:
                        raise AgentRunError(422, "GitHub rejected the request. Check the target branches and existing pull requests.")
                    if response.status_code not in (200, 201):
                        raise AgentRunError(502, "GitHub is unavailable. Try again.")
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > 2 * 1024 * 1024:
                            raise AgentRunError(502, "GitHub returned too much data.")
                    return json.loads(content)
        except (httpx.HTTPError, ValueError):
            raise AgentRunError(502, "Could not contact GitHub. Try again.") from None

    async def _account(self, token):
        data = await self._api(token, "/user")
        if not isinstance(data, dict) or not isinstance(data.get("id"), int) or not isinstance(data.get("login"), str) or not _LOGIN.fullmatch(data["login"]):
            raise AgentRunError(502, "GitHub returned an invalid account.")
        return {"id": data["id"], "login": data["login"], "name": str(data.get("name") or data["login"])[:120], "url": f"https://github.com/{data['login']}"}

    async def connect_token(self, user_id, token):
        if not isinstance(token, str) or not 10 <= len(token.strip()) <= 4096 or any(ord(char) < 33 or ord(char) > 126 for char in token.strip()):
            raise AgentRunError(422, "Enter a valid GitHub access token.")
        async with self._lock(user_id):
            await self._cancel(user_id)
            token = token.strip()
            account = await self._account(token)
            await self.disk(self._save, user_id, token, account)
        return await self.status(user_id)

    async def disconnect(self, user_id):
        async with self._lock(user_id):
            await self._cancel(user_id)
            await self.disk(self._path(user_id).unlink, True)
        return await self.status(user_id)

    async def check(self, user_id):
        data = await self.credentials(user_id)
        if not data:
            raise AgentRunError(409, "Connect your GitHub account in Settings → Connections.")
        account = await self._account(data["token"])
        if account["id"] != data["account"]["id"]:
            raise AgentRunError(409, "The GitHub account changed. Reconnect your account.")
        return {"connected": True, "account": account, "verified": True}

    async def repositories(self, user_id, page):
        if isinstance(page, bool) or not isinstance(page, int) or not 1 <= page <= 100:
            raise AgentRunError(422, "Enter a valid repository page.")
        data = await self.credentials(user_id)
        if not data:
            raise AgentRunError(409, "Connect your GitHub account in Settings → Connections.")
        items = await self._api(data["token"], "/user/repos", {"per_page": 50, "page": page, "sort": "updated", "affiliation": "owner,collaborator,organization_member"})
        if not isinstance(items, list):
            raise AgentRunError(502, "GitHub returned an invalid repository list.")
        repositories = [
            {"name": item["full_name"], "url": f"https://github.com/{item['full_name']}", "private": bool(item.get("private")), "fork": bool(item.get("fork")), "can_push": bool((item.get("permissions") or {}).get("push"))}
            for item in items
            if isinstance(item, dict) and isinstance(item.get("full_name"), str) and _REPOSITORY.fullmatch(item["full_name"])
        ]
        return {"repositories": repositories, "next_page": page + 1 if len(items) == 50 else None}

    async def repository(self, user_id, slug, *, require_push=False, credentials=None):
        if not isinstance(slug, str) or not _REPOSITORY.fullmatch(slug) or any(part in (".", "..") for part in slug.split("/")):
            raise AgentRunError(422, "Enter a valid GitHub repository.")
        data = credentials if credentials is not None else await self.credentials(user_id)
        if not data:
            raise AgentRunError(409, "Connect your GitHub account in Settings → Connections before pushing.")
        repository = await self._api(data["token"], f"/repos/{slug}")
        if not isinstance(repository, dict) or not isinstance(repository.get("full_name"), str):
            raise AgentRunError(502, "GitHub returned an invalid repository.")
        if require_push and not (repository.get("permissions") or {}).get("push"):
            raise AgentRunError(403, "Your connected GitHub account cannot push to the contribution repository.")
        return repository

    async def _cancel(self, user_id):
        attempt = self.attempts.pop(user_id, None)
        if attempt and attempt.task and not attempt.task.done():
            attempt.task.cancel()
            await asyncio.gather(attempt.task, return_exceptions=True)

    async def cancel_login(self, user_id):
        async with self._lock(user_id):
            await self._cancel(user_id)
        return await self.status(user_id)

    async def begin_login(self, user_id):
        async with self._lock(user_id):
            attempt = self.attempts.get(user_id)
            if attempt and attempt.task and not attempt.task.done() and attempt.expires_at > time.time():
                return await self.status(user_id)
            executable = await self.disk(shutil.which, "gh")
            if not executable:
                raise AgentRunError(503, "Browser authorization requires GitHub CLI on the RepoFlow server. You can connect using a token.")
            await self._cancel(user_id)
            attempt = LoginAttempt()
            self.attempts[user_id] = attempt
            attempt.task = asyncio.create_task(self._login(user_id, attempt, executable))
        return await self.status(user_id)

    @staticmethod
    def _cli_environment(folder):
        allowed = {"PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "SYSTEMROOT", "WINDIR"}
        env = {key: value for key, value in os.environ.items() if key in allowed}
        env.update(GH_CONFIG_DIR=str(folder), GIT_CONFIG_GLOBAL=str(folder / "gitconfig"), GIT_CONFIG_NOSYSTEM="1", GH_PROMPT_DISABLED="1", GH_BROWSER=shlex.join([sys.executable, "-c", "pass"]), NO_COLOR="1", TERM="dumb")
        return env

    async def _login(self, user_id, attempt, executable):
        process = None
        folder = None
        try:
            folder = Path(await self.disk(tempfile.mkdtemp, "", "repoflow-github-"))
            env = self._cli_environment(folder)
            async with asyncio.timeout(900):
                process = await asyncio.create_subprocess_exec(
                    executable,
                    "auth",
                    "login",
                    "--hostname",
                    "github.com",
                    "--git-protocol",
                    "https",
                    "--web",
                    "--insecure-storage",
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    env=env,
                )
                while line := await process.stdout.readline():
                    match = _DEVICE_CODE.search(line.decode(errors="replace"))
                    if match:
                        attempt.code = match[0]
                        attempt.state = "pending"
                if await process.wait() != 0:
                    raise AgentRunError(502, "GitHub browser authorization failed.")
                process = await asyncio.create_subprocess_exec(executable, "auth", "token", "--hostname", "github.com", stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, env=env)
                token_bytes, _ = await asyncio.wait_for(process.communicate(), timeout=15)
                if process.returncode != 0:
                    raise AgentRunError(502, "GitHub browser authorization failed.")
                token = token_bytes.decode().strip()
                account = await self._account(token)
                async with self._lock(user_id):
                    if self.attempts.get(user_id) is not attempt:
                        return
                    await self.disk(self._save, user_id, token, account)
                    attempt.code = ""
                    attempt.state = "connected"
        except asyncio.CancelledError:
            raise
        except Exception:
            attempt.code = ""
            attempt.state = "failed"
        finally:
            if process is not None and process.returncode is None:
                try:
                    process.terminate()
                except ProcessLookupError:
                    pass
                try:
                    await asyncio.wait_for(process.wait(), timeout=3)
                except TimeoutError:
                    try:
                        process.kill()
                    except ProcessLookupError:
                        pass
                    await process.wait()
            if folder is not None:
                await self.disk(shutil.rmtree, folder, True)
