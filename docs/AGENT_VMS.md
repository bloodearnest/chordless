# Agent VMs

A Claude Code agent can run in an [Incus](https://linuxcontainers.org/incus/) virtual machine of its own
(`scripts/agent-vm.sh`, `just agent-*`), so that what it runs cannot reach the developer's computer:
its files, its other credentials, its browser sessions. The agent has `sudo` in the VM and may do what
it likes there.

What the boundary is, and is not: the VM protects **the host**. What an agent can do to the
**chordless repository, Google and Cloudflare** is bounded by the tokens it is given, so those are
scoped to this project and no further (below). The VM has network access, and the tokens are in
its environment, so a hostile program in it could use them: that is the trade for letting agents
push and deploy.

## Use

```
just agent-create [NAME]          # a name is generated if none is given; takes a few minutes
just agent-list
just agent-claude [NAME]          # Claude Code in it, with Remote Control on
just agent-shell [NAME] [-- CMD]
just agent-destroy NAME
```

NAME may be left out when there is one VM. A VM is made once and **reused**: `/clear` the agent, or
stop and start the VM (`incus stop NAME`, started again by the next command), and its worktrees and
installed tools are still there. Work in it as in any checkout (`CLAUDE.md`): the VM's clone of the
repository is its primary checkout, and each topic is a worktree in `.claude/worktrees/`. It
pushes over https with `GH_TOKEN`. Anything the agent needs to keep must be pushed: destroying the
VM deletes its disk.

`just agent-claude NAME -- --dangerously-skip-permissions` passes the rest to Claude Code, which is
what the VM is for. `--no-rc` turns off Remote Control.

## What is in a VM

- Ubuntu 24.04, 4 CPUs, 8 GiB, 40 GiB (`AGENT_CPU`, `AGENT_MEMORY`, `AGENT_DISK`), from the Incus
  profile `chordless-agent`, which `create` writes (and rewrites, so a change reaches the next VM).
- A user `agent` with the developer's uid, and passwordless `sudo`.
- mise, and the tools in `mise.toml`; the repository cloned, `npm ci`, Playwright's Chromium and its
  system libraries; `gh`; Claude Code, from npm (its own installer runs a binary from `~/.claude`,
  which is a share, and a program cannot run from there).
- `~/.claude`: a directory of the developer's computer, `~/.local/share/chordless/agents/NAME/claude`,
  shared in. `create` copies `~/.claude/.credentials.json` into it, so the VM is signed in as the
  developer (Remote Control needs a claude.ai login; `--no-auth` leaves it out, and `/login` in the
  VM does it by hand). Nothing else from the developer's `~/.claude` is copied: its settings, hooks
  and skills would run on the host the next time Claude Code starts there if the VM could write to
  them. The directory is deleted with the VM.

## Tokens

`~/.config/chordless/agent.env` (`AGENT_ENV_FILE`), mode 600, one `KEY=VALUE` per line:

```
GH_TOKEN=...                       # gh, and git's credential helper in the VM
CLOUDFLARE_API_TOKEN=...           # wrangler, Terraform
CLOUDSDK_AUTH_ACCESS_TOKEN=...     # gcloud, Terraform's Google provider
```

Each session gets them as `incus exec --env`, so they are not in Incus's configuration, the VM's disk or
its backups. They are in the environment of the agent and everything it runs, which is the point. A
missing file means a VM with no tokens. Scope them to this project:

- **GitHub**: a fine-grained token for this repository only: contents and pull requests (write), not
  administration, and not workflows unless an agent is to change them. `main` is protected by the
  ruleset (`infra/github/`) whatever the token can do.
- **Cloudflare**: an API token for this account and zone, with only the permissions `infra/` and
  `wrangler.toml` use. Not the token CI deploys with: its own, so that either can be revoked alone.
- **Google**: an access token for a service account that has only the roles this project needs
  (`gcloud auth print-access-token --impersonate-service-account=...` makes one that expires in an
  hour), or a key for it.

## Limits

- A virtual machine is far stronger than a container, but it is on the host's network: it can reach
  services the host listens on (`incusbr0`'s address is the host). Incus network ACLs can close that.
- The VM is signed in with the developer's claude.ai account until `destroy` (or the login is revoked).
  Two sessions that refresh the same login race, and one may need `/login` again.
- Refresh tokens are copied once, at `create`.
