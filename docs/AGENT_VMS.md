# Agent VMs

A Claude Code agent can run in an [Incus](https://linuxcontainers.org/incus/) virtual machine of its
own, so that what it runs cannot reach the developer's computer: its files, its other credentials, its
browser sessions. The agent has `sudo` in the VM and may do what it likes there.

The tool is **`agent`**, a generic script kept by the developer outside this repository (it is not chordless's:
it serves any project). This repository holds only what is chordless's: `.agent-vm/`, and the
tokens below.

## Use

In a checkout or worktree of this repository:

```
agent claude            # Claude Code in this directory's VM (made on first use), Remote Control on
agent shell             # a shell in it
agent run -- just lint  # one command, no terminal
agent stop | destroy    # this directory's VM
```

There is one VM per directory (a worktree gets its own, with the repository's git directory mounted
too, so `git` works), reused after the first time. The directory is the checkout itself, shared in, so
the agent's changes are on the host: commit and push from either side. Run `agent` with no arguments for the rest.

## `.agent-vm/`

- `packages`: `gh`, for pull requests.
- `setup.sh`: run once when the VM is made. `mise install` (the tools `mise.toml` pins), `npm ci`,
  Playwright's Chromium and its system libraries, and git pushing over https with `GH_TOKEN` (the VM has no SSH key).
- `env`: the names of the host environment variables that are passed in (below). Values never come from
  the repository.

## Tokens

The values go in `~/.config/agent/env` (mode 600, `KEY=VALUE` lines), or in the host's environment. Each
session gets them as `incus exec --env`: they are not in Incus's configuration or on the VM's disk. They are
in the environment of the agent and everything it runs, which is the point, so scope them to this project:

- `GH_TOKEN`: a fine-grained token for this repository only: Contents and Pull requests (read and write),
  not Administration, and not Workflows unless an agent is to change them. `main` is protected by the
  ruleset (`infra/github/`) whatever the token can do.
- `CLOUDFLARE_API_TOKEN`: for this account and zone, with only the permissions `infra/` and `wrangler.toml`
  use (Workers Scripts and R2 Storage: Edit at the account; Workers Routes, DNS, Zone Settings, Zone and
  Email Routing Rules on `chordless.app`). Not CI's token: its own, so either can be revoked alone. Read-only
  versions of those permissions allow a `terraform plan` but not `just deploy`.
- `GOOGLE_OAUTH_ACCESS_TOKEN` and `CLOUDSDK_AUTH_ACCESS_TOKEN`: the same access token, for Terraform's Google
  stacks and `gcloud`. Made for an hour from the service account `agent-vm@chordless-app.iam.gserviceaccount.com`
  (`infra/google-ci`: read-only on both projects, Viewer and API Keys Viewer; add roles there for an agent that
  is to change something), which only the owner may impersonate:
  `gcloud auth print-access-token --impersonate-service-account=agent-vm@chordless-app.iam.gserviceaccount.com`

A token left out is just not passed in.

## Limits

- The checkout is shared with the VM over virtiofs, and Ubuntu 24.04's stock 6.8 kernel cannot execute a
  file from such a share (`Bad address`), which would break `just` (it runs `scripts/*.sh` directly) and
  `node_modules/.bin`. The tool's base image installs the HWE kernel (6.11 or later) for that. If `just`
  says "Bad address" in a VM, the base image has an old kernel: `agent build -f`.
- A virtual machine is far stronger than a container, but it is on the host's network and can reach services the
  host listens on. Incus network ACLs can close that.
- `~/.claude` (and `~/.codex`) are shared in read-write, so sessions and memory carry over. The agent can
  therefore change their settings and hooks, which run on the host the next time Claude Code starts there.
- The VM is signed in with the developer's Claude account (through the shared `~/.claude`).
