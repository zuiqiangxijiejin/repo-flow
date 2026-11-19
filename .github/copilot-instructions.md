# RepoFlow repository guidance

RepoFlow is a workspace for GitHub repository collaboration, with a Next.js
frontend, a FastAPI Gateway, an embedded agent runtime and installable extensions.

Read [AGENTS.md](../AGENTS.md) and the nearest scoped guide before editing.
They define the current architecture, boundaries and verification commands.
Use [CONTRIBUTING.md](../CONTRIBUTING.md) for the contribution workflow and
[the documentation index](../docs/README.md) for installation and usage.

Run commands from the repository root unless a scoped guide says otherwise.
Start with `make config`, `make install` and `make dev` for a fresh local setup.
The default browser entry point is `http://localhost:2026`.

Before committing frontend changes, run `pnpm check` and the relevant tests in
`frontend/`, using `scripts/pnpm.py` for host pnpm calls from the repository root.
Backend checks are described in [backend/AGENTS.md](../backend/AGENTS.md).
Live-provider tests require explicit opt-in and credentials; offline checks
must not read the operator's own configuration or runtime data.

Keep credentials, user conversations, runtime databases, uploads, local reports,
`.env`, `config.yaml` and `.repoflow/` out of commits. Publish only configuration
templates with placeholder values. Preserve licenses and third-party notices.
