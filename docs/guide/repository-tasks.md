# Repository conversations

RepoFlow is a general-purpose assistant with specialized support for GitHub
repositories. In a regular Agent conversation, a signed-in user can open
**Repository** in the toolbar or composer. **Add repository** in the sidebar
saves the repository for the signed-in account and opens a new conversation.
Select **Clone and prepare this conversation now** to download immediately.
By default the association is saved first. Use **Clone repository** in the
conversation or send the first task to prepare it before the Agent runs.
The optional clone directory is an existing writable directory on the
server. RepoFlow creates an account- and repository-specific subdirectory
there. Leaving the field empty uses the saved location or the default
under the repository task storage directory.

Open **Settings → Connections → GitHub** to connect your own GitHub account.
**Connect GitHub** displays a one-time code and a link to GitHub's browser
authorization page. Enter the code there and approve the requested permissions.
RepoFlow updates the connection status automatically. **Use an access token**
also accepts a personal token; a fine-grained token can limit access to selected
repositories and needs **Contents: Read and write** for pushes and **Pull requests: Read and write** for PR creation.
The repository picker can populate the contribution address and a fork's upstream
from your connected account. **Verify connection** checks the saved authorization,
and **View accessible repositories** shows the permissions GitHub reports.
**Disconnect** removes the credentials saved in RepoFlow. GitHub-side application
authorization can be revoked separately in your GitHub account settings.

Use **Contribution repository URL** for a repository you can push to. When
contributing to another project, enter your fork there and the official
repository under **PR target repository URL**. The upstream default branch
provides the base. For a PR to the contribution repository itself, leave the
upstream field empty.

RepoFlow checks URL format when you leave the address fields. When you supply
a PR target, it checks the repository relationship against GitHub metadata
before importing, using your connected account when available. Correct reversed
links, duplicate addresses or repositories from different fork networks before
continuing. If GitHub cannot provide accessible metadata, the form reports that
it could not verify the pair.

Saved repositories stay in the sidebar after a reload. Click a saved repository
to open a new conversation, then prepare its worktree and contribution branch
when you are ready to use it.
Follow-up messages in an existing conversation use its original worktree.
**Remove** hides the saved repository for your account. When a shared
clone exists, choose whether to delete it or keep it for later. Use **Manage
clones** to find and delete shared clones stored on the server. Each
conversation keeps its own working files. Re-adding an imported repository
with the same URLs restores its saved entry. To change an already cloned
repository's storage directory, delete its shared clone before saving a new
directory.

Use **Select chats** beside recent conversations to select individual
conversations or all loaded entries. The confirmation shows the number of
conversations selected for deletion. You can retry entries that fail.

Open **View changes** whenever the conversation is idle to compare files in
the resizable review panel. The recent-conversation list labels the contribution
branches. The review panel shows the exact commit, push destination and PR
target. Both sidebars can be collapsed. **Run regression tests** above the
composer prepares a message in the empty composer for you to review and send.
Open **Repository settings** in the left sidebar to save a test command and
optional repository-relative working directory. Those settings apply to your
conversations for the selected repository and are included in the prepared
message. Leave both fields empty to let the Agent choose checks based on the
repository and the changes. The **Regression
tests** tab displays the Agent report when one is available. Repository
**Issues** and **PR** links open the target on GitHub.

Conversation tables and code blocks share the workspace palette in light and
dark mode. Fullscreen tables keep the same colors as their inline preview.
The lavender workspace keeps a dark navigation sidebar, which can collapse to
an icon rail. Its SSH, repository settings and clone-management icons open the
same dialogs directly while collapsed, with hover descriptions. Repository, branch, conversation and model labels wrap to show
their full text. The conversation header grows with its content. The review
panel remains resizable; narrow screens use its existing drawer presentation.

Git review separates the workflow, contribution context, file statistics and
publication form. Its milestones use the reviewed commit, exact published SHA
and PR receipt for the saved target. A draft PR is labelled as a draft, and a
closed PR retains its closed status. The Diff viewer initially renders 200
lines per file; **Show more lines** appends the next batch. This changes only
the display, and keeps every line available. Agent activity cards reuse actual
message and tool-result records; test reports remain the Agent's original
report without inventing structured pass/fail counts.

The Agent can inspect the current host Git status with `repository_changes`
and read an original text file with `repository_baseline`. Both tools are
owner-scoped and read-only, so checking or restoring an unintended edit does
not require fetching a possibly different upstream copy. Truncated results
are marked and must not be used as a complete editing baseline.

Ask the Agent to prepare a commit, push or PR in the conversation. It can read
publication status and queue a publication request using host-bound tools. The
application waits for the run to end, opens review and captures the files as a
fixed commit. It never needs a Git token or `.git` inside the sandbox. Review
opened during a run waits and refreshes automatically when the conversation is idle.

Local Git checkpoints are recorded at turn start, after tool operations when
files changed, and at turn end. A tool that fails after writing still leaves a
checkpoint. Unchanged trees add no commit. **Change history** in the Git review
panel lists timestamps, files and checkpoint diffs; the record belongs to the
conversation and stays after a reload. Checkpoints form their own local Git
history. The final reviewed contribution commit is selected separately for
pushing. Earlier edits made before automatic recording was enabled are included
in the first starting snapshot, rather than reconstructed as invented steps.

After a confirmed push, its receipt identifies the fork, branch and published
commit. Reloading the conversation retains this status and its PR form link.

The **Publish / PR** tab contains the title, description, target repository and
base branch. Choose the contribution repository for a PR within your fork or
the registered upstream for an official contribution. Branch suggestions come
from GitHub; an existing branch may also be entered manually. The workspace diff uses the conversation's original base. Saving the PR target
fetches its actual base commit and computes a separate PR diff from the merge
base, including commits that have not been pushed yet. Changing PR fields invalidates
an outstanding confirmation. Push and PR creation have separate confirmations.

**Push contribution branch** asks you to confirm the exact reviewed commit.
After pushing, open the prefilled GitHub form, or save the PR details and confirm
**Create draft PR** or **Create PR** in RepoFlow. Only a GitHub receipt with a PR
number is shown as a created PR; a compare-form link is recorded separately.
An uncertain PR creation is reconciled against existing open PRs before another
attempt. The application does not retry external writes automatically.

A GitHub draft PR is a real PR in the selected repository. **Save PR details**
keeps the form in RepoFlow without creating a GitHub PR. Both GitHub creation
buttons open a dialog showing the repository, branch and title. Check the target
acknowledgement before clicking the final confirmation. Cancelling or closing
the dialog sends no creation request. The stored confirmation records the exact
commit, target, draft choice and form revision.
The confirmation separates the target fields, visibility explanation and
acknowledgement. Long names wrap within the dialog. On short screens its content
scrolls while Cancel and the final confirmation remain visible at the bottom.

Publication actions remain visible after a push or PR creation. Unavailable
actions are disabled with hover explanations. **Refresh changes** reads the
remote PR state, including closed and merged PRs. An open PR follows further
pushes to its contribution branch. Changing the target or editing PR fields
keeps the title, description, receipt and buttons visible; save the changes
before creating a PR for the new target.

Operator-registered checkouts, SSH aliases and custom server clone directories
remain administrator-only. Other users can import and publish their own
repositories within the default account-scoped storage and configure their own
SSH profiles.

User-imported repositories use the connection belonging to the conversation
owner, and RepoFlow checks its write permission before pushing.
New contribution commits use that account's GitHub username and ID-based private
commit email for both author and committer. Unpublished previews are regenerated
after connecting GitHub; existing published commits retain their original SHA
and authorship. The publication form shows the commit author.

To update the fork after editing files, refresh changes and confirm pushing the
new commit. An unchanged commit needs no repeat push. **Correct commit author**
can instead prepare the same file tree, parents and message with the connected
GitHub identity. It does not push immediately. Review the old and new SHAs and
confirm the separate fork push. This uses an explicit `--force-with-lease` for
the previously published SHA and refuses to overwrite a remote branch that has
advanced. The GitHub account performing a push and the Git author recorded
inside a commit are separate identities.

Publication buttons show their purpose on hover. **Refresh changes** reloads the
review, **Save PR details** saves the complete form, and **Push to my fork** sends
the reviewed commit to the contribution repository. An already pushed commit
keeps its push button disabled. **Create draft PR** and **Create PR** open separate
confirmations for the selected target; cancelling leaves the form intact.

## Operator setup

Start the Gateway with `REPOFLOW_PROFILE=workspace` for a repository-focused
deployment. It leaves out the browser, channel, scheduled-task, memory,
integrations, knowledge, observability console and input-polishing HTTP APIs
and skips channel and scheduler workers. Use `REPOFLOW_PROFILE=full` for an
installation using those APIs. Keep `scheduler.enabled` and
`scheduler.tool_enabled` off in a workspace-only configuration.

Install the package in the Gateway's Python environment, configure its storage
and model-facing middleware in the operator-controlled `config.yaml`, and restart the Gateway. The
`repositories` map is optional and exposes operator-registered checkouts.
Use the built-in sandbox configuration with per-thread workspace mounts.
The configured middleware gives the default assistant its RepoFlow identity
on new replies and supplies the workspace path for prepared repositories.
When the system instructions are plain text, the workspace instructions are
appended as plain text for model providers that require that format. If the model
provider rejects a request with HTTP 422, the conversation shows a brief
request-format error.

```yaml
extensions:
  middlewares:
    - repoflow_repository_tasks.agent_context:RepositoryContext

plugins:
  - use: repoflow_repository_tasks:install
    required: true
    config:
      storage_path: /srv/repoflow/repository-tasks
      repositories:
        sample:
          path: /srv/checkouts/sample
          branch: main
          push_remote: origin
          upstream_remote: upstream
```

`push_remote` defaults to `origin`. Set `upstream_remote` for a fork to look up
the base commit from the local remote-tracking branch and target the upstream
repository in the GitHub form. For a directly owned repository, omit
`upstream_remote` to use the local base branch and target the same repository.
Refresh an operator-registered base ref before attaching the repository when
you need a newer commit. The conversation uses its normal model selection.

The Gateway requires Git; browser authorization also uses GitHub CLI (`gh`).
Each browser login runs with a private, temporary CLI configuration. After
authorization, RepoFlow encrypts the token and removes the temporary CLI files.
Stored connections are scoped to the signed-in RepoFlow account under
`<storage_path>/github-accounts/`. Back up that directory and its
`.credentials_key`, or preserve the configured `DEER_FLOW_CREDENTIALS_KEY`.
Pending browser authorizations last up to 15 minutes and must be restarted
after a Gateway restart. A token connection works on hosts without GitHub CLI.
Operator-registered checkouts retain operator-configured Git authentication.
Git metadata and credentials live outside the task's
sandbox mount. This extension uses local storage, supports GitHub remotes and
accepts repositories without submodules.

To install Python development dependencies inside repository sandboxes, allow
the Python package index and its download host in the operator configuration,
then restart the Gateway:

```yaml
sandbox:
  network:
    mode: allowlist
    allow_domains:
      - pypi.org
      - files.pythonhosted.org
    approval: deny
```

Create a virtual environment inside the conversation workspace and use its
Python executable for installation and tests. Packages installed there remain
with that conversation's files when its sandbox is recreated. Projects that
derive their version from Git can use their build backend's source-archive
version override for editable installation.

## SSH execution hosts

The conversation toolbar labels the current execution host as **Local** or **SSH · alias**.
Local describes the current RepoFlow server. A remote conversation uses the
remote server's Git checkouts, sandbox, credentials and conversation store.
Opening a remote conversation creates a new chat there.

Every signed-in user can open **SSH connections** in the sidebar and add a
host name, hostname or IP, SSH port, username and password or unencrypted SSH
private key. Saving a host and testing SSH do not require a remote application
address. To open a remote application, supply the already installed RepoFlow application's browser
address, user service name and readiness port. The default service is
`repoflow.target` and the default readiness port is `12026`.

Use **Read host fingerprint**, compare the displayed SHA256 fingerprint with
the server console and explicitly trust it before saving. **Test SSH connection**
checks authentication and the pinned key without starting the remote app.
**Connect remote app** starts the configured user service and offers its browser
link once ready. It does not install RepoFlow or move an existing conversation.
The remote deployment handles its own sign-in and conversations.

Profiles and encrypted credentials belong to the signed-in account. Editing a
profile with its credential field blank keeps the saved credential. Changing
the SSH address or port requires reading and trusting its fingerprint again.
**Delete** removes only that account's saved profile and credential. Profiles
do not inherit the Gateway operator's SSH agent or configuration. Passwords and
private keys are not returned in profile lists or supplied to the Agent.
The Gateway needs OpenSSH's `ssh` and `ssh-keyscan` executables. Back up
`<storage_path>/ssh-accounts/` with the same credentials key as GitHub connections.

Operators may additionally configure concrete OpenSSH aliases for the account running the Gateway. Install
RepoFlow, including the repository extension, on each remote host and set
`execution.ssh_host` to its alias. On the starting instance, add the alias and
an independently reachable browser origin to the same extension's config.

```yaml
execution:
  connections:
    devbox:
      origin: https://repoflow-devbox.example.com
      service: repoflow.target
      port: 12026
```

**SSH connections** in the left sidebar uses OpenSSH to start the configured user unit and wait for
its loopback health check. **Open remote chat** then opens the configured
origin. Use a distinct browser hostname for each deployment so that their
session cookies are isolated. The configured browser origin can be provided by
an existing reverse proxy or tunnel. The Gateway's SSH configuration and host
keys control authentication. The destination instance handles its own sign-in.

The connected-account project picker appears above the contribution URL. It includes writable projects and forks; selecting a fork can fill its upstream automatically. Your own project can be used directly, with the upstream left empty. A fork is needed only when contributing through a separate repository.
