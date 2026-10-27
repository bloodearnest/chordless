#!/usr/bin/env bash
# Agent VMs (docs/AGENT_VMS.md): a Claude Code agent in an Incus virtual machine of its own, so what it
# runs cannot reach this computer's files or credentials, only the tokens passed in for the session.
#
#   scripts/agent-vm.sh create [NAME] [--no-auth]   make a VM (a name is generated if none is given)
#   scripts/agent-vm.sh list                        the agent VMs
#   scripts/agent-vm.sh claude [NAME] [--no-rc] [-- CLAUDE ARGS]   a Claude Code session in it
#   scripts/agent-vm.sh shell [NAME] [-- CMD...]    a shell (or CMD) in it, with the same environment
#   scripts/agent-vm.sh destroy NAME                delete it, and the ~/.claude directory it had
#
# NAME may be left out when there is only one agent VM. A stopped VM is started when it is used, and
# is left running: stop it with `incus stop NAME`. Run it in your own shell, not an agent's.
set -euo pipefail

user=agent
home=/home/$user
repo_dir=$home/chordless
profile=chordless-agent
image=${AGENT_IMAGE:-images:ubuntu/24.04/cloud}
# Tokens for the VM, one KEY=VALUE per line (GH_TOKEN, CLOUDFLARE_API_TOKEN, ...). Passed to each
# session with `incus exec --env`, never stored in Incus's configuration or the VM's disk
env_file=${AGENT_ENV_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/chordless/agent.env}
# Each VM's ~/.claude, on this computer so that it outlasts the VM. Not this user's own ~/.claude:
# what is in it (settings, hooks, skills) would run here the next time Claude Code starts
state_dir=${AGENT_STATE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/chordless/agents}
# Where run_as_agent runs: the repository, except while `create` is still cloning it
workdir=$repo_dir

die() {
  echo "agent-vm: $*" >&2
  exit 1
}

# The agent VMs' names, one per line
agents() {
  incus list "user.chordless-agent=true" --format csv --columns n
}

# The VM to use: the name given, or the only one there is
pick() {
  local name=${1:-}
  if [[ -n "$name" ]]; then
    agents | grep -qx -- "$name" || die "no agent VM called '$name' (scripts/agent-vm.sh list)"
    echo "$name"
    return
  fi
  local all count
  all=$(agents)
  count=$(grep -c . <<<"$all" || true)
  ((count == 1)) || die "$count agent VMs: say which (scripts/agent-vm.sh list)"
  echo "$all"
}

# Start the VM if it is stopped, and wait for its agent to answer
ensure_running() {
  local name=$1
  [[ "$(incus list "$name" --format csv --columns s)" == "RUNNING" ]] || incus start "$name"
  local tries=0
  until incus exec "$name" -- true 2>/dev/null; do
    ((++tries < 120)) || die "$name did not come up"
    sleep 1
  done
}

# The --env options for the tokens in the env file (a missing file is no tokens)
token_args() {
  [[ -f "$env_file" ]] || return 0
  local line
  while IFS= read -r line; do
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && printf '%s\n' --env "$line"
  done <"$env_file"
}

# Run a command in the VM as the agent user, in the repository, with the tokens
run_as_agent() {
  local name=$1
  shift
  local -a envs=()
  mapfile -t envs < <(token_args)
  incus exec "$name" --user "$(id -u)" --group "$(id -g)" --cwd "$workdir" \
    --env HOME="$home" --env USER="$user" --env TERM="${TERM:-xterm}" \
    --env PATH="$home/.local/share/mise/shims:$home/.local/bin:/usr/local/bin:/usr/bin:/bin" \
    "${envs[@]}" -- env "$@"
}

ensure_profile() {
  incus profile show "$profile" >/dev/null 2>&1 || incus profile create "$profile"
  # Cloud-init: the agent user (with the uid of this user, so that the shared ~/.claude is writable
  # from both sides), passwordless sudo, and the packages the repository's tools need. mise, Claude
  # Code and the repository are installed as that user by `create`
  incus profile edit "$profile" <<EOF
config:
  limits.cpu: "${AGENT_CPU:-4}"
  limits.memory: ${AGENT_MEMORY:-8GiB}
  cloud-init.user-data: |
    #cloud-config
    users:
      - name: $user
        uid: $(id -u)
        shell: /bin/bash
        sudo: ALL=(ALL) NOPASSWD:ALL
    package_update: true
    packages: [git, curl, ca-certificates, build-essential, unzip, jq, gh]
description: Chordless agent VM (scripts/agent-vm.sh)
devices:
  root:
    path: /
    pool: default
    type: disk
    size: ${AGENT_DISK:-40GiB}
EOF
}

cmd_create() {
  local name="" auth=1
  while (($#)); do
    case $1 in
      --no-auth) auth=0 ;;
      -*) die "create: unknown option $1" ;;
      *) name=$1 ;;
    esac
    shift
  done
  [[ -n "$name" ]] || name="agent-$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"
  incus info "$name" >/dev/null 2>&1 && die "'$name' already exists"
  [[ -f "$env_file" ]] || echo "No tokens: $env_file does not exist (docs/AGENT_VMS.md); the VM will have none."

  local remote
  remote=$(git config --get remote.origin.url || true)
  [[ -n "$remote" ]] || die "run it in the chordless repository: it has no origin to clone"
  # The VM has no SSH key: it clones and pushes over https, with GH_TOKEN
  remote=$(sed -E 's#^git@github.com:#https://github.com/#' <<<"$remote")

  ensure_profile
  mkdir -p "$state_dir/$name/claude"
  chmod 700 "$state_dir/$name" "$state_dir/$name/claude"
  if ((auth)); then
    if [[ -f "$HOME/.claude/.credentials.json" ]]; then
      install -m 600 "$HOME/.claude/.credentials.json" "$state_dir/$name/claude/.credentials.json"
    else
      echo "No ~/.claude/.credentials.json to copy: log in with /login in the VM."
    fi
  fi

  # Made stopped, so the share is there from the first boot (a share cannot be added to a running
  # VM that was started without shared memory)
  incus init "$image" "$name" --vm --profile default --profile "$profile" --config user.chordless-agent=true
  incus config device add "$name" claude disk source="$state_dir/$name/claude" path="$home/.claude"
  incus start "$name"
  ensure_running "$name"
  incus exec "$name" -- cloud-init status --wait >/dev/null || die "cloud-init failed in $name (incus exec $name -- cloud-init status --long)"
  # A share is owned by its host user: make sure the agent can write to its home
  incus exec "$name" -- chown "$(id -u):$(id -g)" "$home"

  echo "Installing the tools in $name..."
  workdir=$home
  # Without this, Claude Code asks its first-run questions (theme, trust) in each new VM
  run_as_agent "$name" bash -c 'echo "{\"hasCompletedOnboarding\": true}" > ~/.claude.json'
  # shellcheck disable=SC2016 # the script is for the VM's shell to expand
  run_as_agent "$name" bash -c '
    set -euo pipefail
    git config --global user.name "agent $1"
    git config --global user.email "noreply@anthropic.com"
    git config --global credential.helper "!f() { echo username=x-access-token; echo \"password=\$GH_TOKEN\"; }; f"
    git config --global init.defaultBranch main
    curl -fsSL https://mise.run | sh
  ' _ "$name"
  run_as_agent "$name" git clone "$remote" "$repo_dir"
  workdir=$repo_dir
  # shellcheck disable=SC2016 # as above
  run_as_agent "$name" bash -c '
    set -euo pipefail
    mise trust
    mise install
    npm ci
    # By npm, not the native installer: that runs its binary from ~/.claude/downloads, which is on
    # the share, and a program cannot be run from there ("Bad address")
    npm install --global --prefix ~/.local @anthropic-ai/claude-code
    sudo env "PATH=$PATH" npx playwright install-deps chromium
    npx playwright install chromium
  '
  echo
  echo "Ready: scripts/agent-vm.sh claude $name"
}

cmd_list() {
  incus list "user.chordless-agent=true" --columns ns4
}

cmd_claude() {
  local name="" rc=1
  local -a args=()
  while (($#)); do
    case $1 in
      --no-rc) rc=0 ;;
      --)
        shift
        args=("$@")
        break
        ;;
      -*) die "claude: unknown option $1 (Claude's own go after --)" ;;
      *) name=$1 ;;
    esac
    shift
  done
  name=$(pick "$name")
  ensure_running "$name"
  # Remote Control, named for the VM so that claude.ai/code shows which agent is which
  ((rc)) && args=(--remote-control "$name" "${args[@]}")
  run_as_agent "$name" claude "${args[@]}"
}

cmd_shell() {
  local name=""
  if [[ "${1:-}" != "--" && $# -gt 0 ]]; then
    name=$1
    shift
  fi
  [[ "${1:-}" == "--" ]] && shift
  name=$(pick "$name")
  ensure_running "$name"
  # With a command (shell [NAME] -- CMD...) it runs that, in a login shell so that the tools are on PATH
  if (($#)); then
    run_as_agent "$name" bash -lc 'exec "$@"' _ "$@"
  else
    run_as_agent "$name" bash -l
  fi
}

cmd_destroy() {
  local name
  name=$(pick "${1:-}")
  incus delete --force "$name"
  rm -rf -- "${state_dir:?}/$name"
  echo "Deleted $name and its ~/.claude directory."
}

command=${1:-}
shift || true
case $command in
  create) cmd_create "$@" ;;
  list) cmd_list ;;
  claude) cmd_claude "$@" ;;
  shell) cmd_shell "$@" ;;
  destroy)
    [[ $# -ge 1 ]] || die "destroy: say which VM"
    cmd_destroy "$@"
    ;;
  *) die "usage: agent-vm.sh create|list|claude|shell|destroy (see the header of this script)" ;;
esac
