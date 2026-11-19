"""Validate contribution and PR target links with public GitHub metadata."""

from deerflow_extension_api.agent_runs import AgentRunError
from httpx import AsyncClient, RequestError

from .git_tasks import github_slug


class RepositoryLinkError(AgentRunError):
    def __init__(self, reason, message, status_code=422):
        super().__init__(status_code, message)
        self.reason = reason


def _repository_url(value, field):
    if not isinstance(value, str) or len(value) > 300:
        raise RepositoryLinkError(field, "Enter a GitHub repository URL.")
    url = value.strip()
    try:
        return url, github_slug(url)
    except ValueError as exc:
        raise RepositoryLinkError(field, "Enter a GitHub repository URL.") from exc


def repository_urls(payload):
    remote, source = _repository_url(payload.get("url"), "contribution-url")
    value = payload.get("upstream_url", "")
    if not isinstance(value, str):
        raise RepositoryLinkError("target-url", "Enter a GitHub repository URL for the PR target.")
    if not value.strip():
        return remote, source, None, None
    upstream, target = _repository_url(value, "target-url")
    if source.casefold() == target.casefold():
        raise RepositoryLinkError("same-repository", "Leave the PR target blank for a PR to the contribution repository itself.")
    return remote, source, upstream, target


def _unavailable():
    return RepositoryLinkError("github-unavailable", "GitHub could not verify the repository links. Try again.", 503)


def _name(data):
    name = data.get("full_name") if isinstance(data, dict) else None
    return name.casefold() if isinstance(name, str) and name else None


async def _metadata(client, slug, reason):
    try:
        response = await client.get(f"/repos/{slug}")
        if response.status_code == 404:
            raise RepositoryLinkError(reason, "GitHub could not find this repository in its public metadata.")
        if not response.is_success:
            raise _unavailable()
        data = response.json()
    except (RequestError, ValueError) as exc:
        raise _unavailable() from exc
    if not _name(data) or not isinstance(data.get("fork"), bool):
        raise _unavailable()
    return data


async def validate_fork(source, target, token=None):
    """Verify that the contribution repository is a fork in the PR target's network."""
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with AsyncClient(
        base_url="https://api.github.com",
        headers=headers,
        timeout=5.0,
        trust_env=False,
    ) as client:
        contribution = await _metadata(client, source, "contribution-unavailable")
        root = _name(contribution.get("source"))
        if contribution["fork"] and target.casefold() in (root, _name(contribution.get("parent"))):
            return

        destination = await _metadata(client, target, "target-unavailable")
        contribution_name = _name(contribution)
        destination_name = _name(destination)
        if contribution_name == destination_name:
            raise RepositoryLinkError("same-repository", "Leave the PR target blank for a PR to the contribution repository itself.")
        destination_root = _name(destination.get("source")) if destination["fork"] else destination_name
        if not contribution["fork"]:
            if destination_root == contribution_name:
                raise RepositoryLinkError("links-reversed", "Put your fork in the contribution field and the upstream repository in the PR target field.")
            raise RepositoryLinkError("not-a-fork", "Use a fork in the contribution field when providing a separate PR target.")
        if not root or not destination_root:
            raise _unavailable()
        if root != destination_root:
            raise RepositoryLinkError("different-network", "The repositories are in different GitHub fork networks.")
