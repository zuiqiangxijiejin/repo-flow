"""Set the RepoFlow identity and describe the attached repository when present."""

import logging
import re

from deerflow_extension_api import task_store_from_runtime
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import SystemMessage

_DEFAULT_LEAD_ROLE = re.compile(r"<role>\nYou are DeerFlow(?: [0-9.]+)?, an open-source super agent\.\n</role>")
_REPOFLOW_ROLE = """<role>
You are RepoFlow, a general-purpose AI assistant with specialized support for GitHub repositories.
Help with everyday questions, research, writing, data analysis, and coding as appropriate.
For repository work, help users implement changes, run tests, review Git diffs, and prepare pull requests for them to submit.
Introduce yourself as RepoFlow, including in conversations that contain a previous self-introduction.
</role>"""

REPOSITORY_CONTEXT = (
    "This conversation has a Git repository mounted at /mnt/user-data/workspace/repo. "
    "Read the repository's AGENTS.md if present. Use that path when operating on the repository, "
    "including in any instructions you give to subagents. The repository's private Git metadata "
    "is managed by the host. RepoFlow creates reviewed commits and pushes contribution branches "
    "through the application's View changes and Push contribution branch actions, using the user's "
    "GitHub connection from Settings > Connections. Use repository_changes to inspect exact host "
    "Git changes and repository_baseline to read original files. Never search the filesystem or "
    "fetch upstream copies to reconstruct an unchanged file; use the host baseline tool. "
    "The host records local Git checkpoints after changed tool operations; Change history shows "
    "those versions. Local checkpoints and published commits have separate receipts. "
    "To publish, call publication_status and "
    "prepare_publication with a concise PR title and body. This prepares a host review after your "
    "run finishes; the application displays an exact-commit confirmation. Use target=fork for a PR "
    "inside the user's fork, target=upstream for the official project. A push, a prefilled PR form, "
    "and a created PR are distinct states. Report only actual receipts. Do not try to reconstruct "
    ".git, inspect credential environment variables, export patches, or claim publication is impossible "
    "because sandbox GitHub network access is restricted. Never claim a selectable branch exists "
    "unless the host returned it. Report the changes and checks actually performed. "
    "When asked to prepare a pull request, suggest a title on its own line beginning with 'PR title: '."
)


def _replace_lead_role(block):
    if isinstance(block, str):
        return _DEFAULT_LEAD_ROLE.sub(_REPOFLOW_ROLE, block, count=1)
    if block.get("type") == "text" and isinstance(text := block.get("text"), str):
        branded = _DEFAULT_LEAD_ROLE.sub(_REPOFLOW_ROLE, text, count=1)
        if branded != text:
            return {**block, "text": branded}
    return block


class AttachedRepository:
    """Task-scoped marker set by the repository extension."""

    def __init__(self, checkpoint=None):
        self.checkpoint = checkpoint


class RepositoryContext(AgentMiddleware):
    """Model-facing context loaded through the operator's agent middleware configuration."""

    def _model_request(self, request):
        store = task_store_from_runtime(request.runtime)
        attached = store is not None and store.get(AttachedRepository) is not None
        current = request.system_message
        content = current.content if current is not None else ""
        if isinstance(content, str):
            # Some providers require system message content to be a string.
            updated = _replace_lead_role(content)
            if attached:
                updated = f"{updated}\n\n{REPOSITORY_CONTEXT}" if updated else REPOSITORY_CONTEXT
        else:
            updated = [_replace_lead_role(block) for block in content]
            if attached:
                updated.append({"type": "text", "text": REPOSITORY_CONTEXT})
        if updated == content:
            return request
        message = current.model_copy(update={"content": updated}) if current is not None else SystemMessage(content=updated)
        return request.override(system_message=message)

    def wrap_model_call(self, request, handler):
        return handler(self._model_request(request))

    async def awrap_model_call(self, request, handler):
        return await handler(self._model_request(request))

    async def awrap_tool_call(self, request, handler):
        try:
            return await handler(request)
        finally:
            store = task_store_from_runtime(request.runtime)
            attached = store.get(AttachedRepository) if store is not None else None
            if attached and attached.checkpoint:
                call = request.tool_call
                try:
                    await attached.checkpoint("tool: " + str(call.get("name", "operation")), str(call.get("id", "")))
                except Exception:
                    logging.getLogger(__name__).warning("Could not record the repository tool checkpoint")
