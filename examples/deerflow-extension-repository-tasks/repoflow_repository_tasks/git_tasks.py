"""Git operations for a task. Git metadata stays outside the sandbox mount."""

from __future__ import annotations

import base64
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlencode

from deerflow_extension_api.agent_runs import AgentRunError

MAX_DIFF = 512 * 1024
_GITHUB_REMOTE = re.compile(r"(?:https://github\.com/|git@github\.com:)([A-Za-z0-9-]+/[A-Za-z0-9_.-]+?)(?:\.git)?\Z")


def git(*args, network=False, publishing=False, token=None):
    # Do not inherit repository selection or injected configuration from the process.
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1", LC_ALL="C")
    if not network and not publishing:
        env["GIT_CONFIG_GLOBAL"] = os.devnull
    if token is not None:
        # Supply credentials only for this Git process, outside argv and remotes.
        env["GIT_CONFIG_GLOBAL"] = os.devnull
        env.update(GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0="credential.helper", GIT_CONFIG_VALUE_0="")
        if token:
            authorization = base64.b64encode(f"x-access-token:{token}".encode()).decode()
            env.update(GIT_CONFIG_COUNT="2", GIT_CONFIG_KEY_1="http.https://github.com/.extraheader", GIT_CONFIG_VALUE_1=f"AUTHORIZATION: basic {authorization}")
    with tempfile.TemporaryFile() as output:
        try:
            subprocess.run(
                [
                    "git",
                    "-c",
                    "core.hooksPath=/dev/null",
                    "-c",
                    "core.fsmonitor=false",
                    *map(str, args),
                ],
                check=True,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.DEVNULL,
                timeout=22,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            if publishing:
                detail = "Push failed or timed out. Check GitHub authentication and retry."
            elif network:
                detail = "Could not read the GitHub repository. Check the URL and repository access."
            else:
                detail = "Git could not complete the repository operation."
            raise AgentRunError(409, detail) from exc
        output.seek(0)
        data = output.read(MAX_DIFF + 1)
    if len(data) > MAX_DIFF:
        raise AgentRunError(413, "The Git diff is too large to review in RepoFlow.")
    return data.decode("utf-8", "replace")


def github_slug(remote):
    match = _GITHUB_REMOTE.fullmatch(remote)
    if not match or any(part in (".", "..") for part in match[1].split("/")):
        raise ValueError("Repository tasks require a GitHub destination")
    return match[1]


@dataclass(frozen=True)
class Repository:
    path: Path
    branch: str | None
    push_remote: str
    upstream_remote: str | None

    def registration(self):
        if not self.path.is_absolute() or not self.path.is_dir():
            raise ValueError("Repository path must be an existing absolute directory")
        if not self.branch:
            raise ValueError("Repository has no saved base branch")
        git("check-ref-format", f"refs/heads/{self.branch}")
        origin = git("-C", self.path, "remote", "get-url", "--push", self.push_remote).strip()
        target = git("-C", self.path, "remote", "get-url", self.upstream_remote).strip() if self.upstream_remote else origin
        return origin, github_slug(origin), github_slug(target)

    def base(self):
        if not self.branch:
            raise AgentRunError(409, "Prepare the repository first.")
        namespace = f"refs/remotes/{self.upstream_remote}" if self.upstream_remote else "refs/heads"
        return git(
            "-C",
            self.path,
            "rev-parse",
            "--verify",
            f"{namespace}/{self.branch}^{{commit}}",
        ).strip()


def clone_repository(destination, remote, upstream, token=None):
    if token:
        remote = f"https://github.com/{github_slug(remote)}.git"
        upstream = f"https://github.com/{github_slug(upstream)}.git" if upstream else None
    git(
        "clone",
        "--bare",
        "--single-branch",
        "--no-tags",
        "--no-recurse-submodules",
        "--origin",
        "origin",
        "--",
        remote,
        destination,
        network=True,
        token=token,
    )
    if upstream:
        default = git("ls-remote", "--symref", "--", upstream, "HEAD", network=True, token=token)
        match = re.search(r"^ref: refs/heads/(.+)\tHEAD$", default, re.MULTILINE)
        if not match:
            raise AgentRunError(422, "The upstream repository has no default branch.")
        branch = match[1]
        git("check-ref-format", f"refs/heads/{branch}")
        git("-C", destination, "remote", "add", "upstream", upstream)
        git(
            "-C",
            destination,
            "fetch",
            "--no-tags",
            "--no-recurse-submodules",
            "upstream",
            f"refs/heads/{branch}:refs/remotes/upstream/{branch}",
            network=True,
            token=token,
        )
    else:
        branch = git("-C", destination, "symbolic-ref", "--short", "HEAD").strip()
    repository = Repository(destination, branch, "origin", "upstream" if upstream else None)
    repository.base()
    return branch


def prepare(repository, private_repo, workspace, base):
    if workspace.exists() or workspace.is_symlink():
        raise AgentRunError(409, "The task workspace already exists.")
    git(
        "clone",
        "--bare",
        "--local",
        "--no-hardlinks",
        "--no-tags",
        "--",
        repository.path,
        private_repo,
    )
    if any(line.startswith("160000 ") for line in git("--git-dir", private_repo, "ls-tree", "-r", base).splitlines()):
        raise AgentRunError(422, "This repository uses Git submodules, which P1 does not stage.")
    git(
        "--git-dir",
        private_repo,
        "worktree",
        "add",
        "--detach",
        "--lock",
        "--",
        workspace,
        base,
    )
    marker = workspace / ".git"
    expected = private_repo / "worktrees" / workspace.name
    if marker.read_text().strip() != f"gitdir: {expected}":
        raise AgentRunError(409, "Unexpected Git worktree layout.")
    marker.unlink()
    # Rootless AIO can use an alternate UID. Preserve Git's executable bit.
    for directory, dirs, files in os.walk(workspace):
        Path(directory).chmod(0o777)
        for file in files:
            path = Path(directory) / file
            if not path.is_symlink():
                path.chmod(0o777 if path.stat().st_mode & 0o111 else 0o666)


def capture(private_repo, workspace, base, title, previous=None, author=None):
    if not workspace.is_dir() or workspace.resolve() != workspace:
        raise AgentRunError(409, "The task repository is missing or has moved.")
    prefix = (
        "--git-dir",
        private_repo / "worktrees" / workspace.name,
        "--work-tree",
        workspace,
    )
    git(*prefix, "add", "-A", "--", ".")
    tree = git(*prefix, "write-tree").strip()
    patch = git(
        "--git-dir",
        private_repo,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--binary",
        base,
        tree,
        "--",
    )
    previous = previous or {}
    author = author or {"name": "RepoFlow", "email": "repoflow@users.noreply.github.com"}
    published = previous.get("published_commit")
    if not patch and not published:
        return {"diff": "", "commit": None, "tree": tree}
    if previous.get("tree") == tree and previous.get("commit"):
        name, email = git("--git-dir", private_repo, "show", "-s", "--format=%an%x00%ae", previous["commit"]).strip().split("\0")
        existing_author = {"name": name, "email": email}
        # Published history stays immutable. An unpublished automation preview
        # is replaced once the owner connects their personal GitHub account.
        if published == previous["commit"] or existing_author == author:
            return {"diff": patch, "commit": previous["commit"], "tree": tree, "commit_author": existing_author}
    commit = git(
        "--git-dir",
        private_repo,
        "-c",
        f"user.name={author['name']}",
        "-c",
        f"user.email={author['email']}",
        "commit-tree",
        tree,
        "-p",
        published or base,
        "-m",
        title,
    ).strip()
    git(
        "--git-dir",
        private_repo,
        "update-ref",
        f"refs/repoflow/reviews/{commit}",
        commit,
    )
    return {"diff": patch, "commit": commit, "tree": tree, "commit_author": author}


def replace_author(private_repo, workspace, commit, author):
    prefix = ("--git-dir", private_repo / "worktrees" / workspace.name, "--work-tree", workspace)
    git(*prefix, "add", "-A", "--", ".")
    tree = git(*prefix, "write-tree").strip()
    if tree != git("--git-dir", private_repo, "rev-parse", f"{commit}^{{tree}}").strip():
        raise AgentRunError(409, "Review and push new file changes before correcting the published author.")
    parents = git("--git-dir", private_repo, "show", "-s", "--format=%P", commit).split()
    message = git("--git-dir", private_repo, "show", "-s", "--format=%B", commit).rstrip()
    parent_args = [part for parent in parents for part in ("-p", parent)]
    replacement = git("--git-dir", private_repo, "-c", f"user.name={author['name']}", "-c", f"user.email={author['email']}", "commit-tree", tree, *parent_args, "-m", message).strip()
    git("--git-dir", private_repo, "update-ref", f"refs/repoflow/reviews/{replacement}", replacement)
    return {"commit": replacement, "tree": tree, "commit_author": author}


def publish(private_repo, remote, commit, branch, token=None, replace_commit=None):
    if token:
        remote = f"https://github.com/{github_slug(remote)}.git"
    git(
        "--git-dir",
        private_repo,
        "push",
        *([f"--force-with-lease=refs/heads/{branch}:{replace_commit}"] if replace_commit else []),
        "--",
        remote,
        f"refs/repoflow/reviews/{commit}:refs/heads/{branch}",
        publishing=True,
        token=token,
    )


def compare_url(target, fork, base, branch, title, body):
    owner, _ = fork.split("/")
    head = branch if target.lower() == fork.lower() else f"{owner}:{branch}"
    compare = quote(base, safe="") + "..." + quote(head, safe=":")
    query = urlencode({"quick_pull": "1", "title": title[:120], "body": body[:1400]})
    return f"https://github.com/{target}/compare/{compare}?{query}"
