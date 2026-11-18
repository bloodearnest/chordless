#!/usr/bin/env bash
# Try a branch from a phone: `just branch-preview <branch>` (docs/PREVIEWS.md).
#
# Serves the branch's dev server (`npm run dev`, port 8787) and puts it on the tailnet at the machine's
# own https://<machine>.<tailnet>.ts.net with `tailscale serve`. One preview at a time, always on the
# same origin, so the browser's data and sign-in carry over from one branch to the next. The local
# database (the register of teams: accounts, a test Team) is one shared copy in .preview/state,
# which every previewed branch's .wrangler/state points at.
#
#   preview.sh start <branch>   serve this branch (stopping any other)
#   preview.sh stop             stop serving
#   preview.sh status           what is being served, and where
#   preview.sh snapshot         seed .preview/state from this machine's dev database (.wrangler/state)
set -euo pipefail

port=8787

# The primary checkout, wherever this is run from (a worktree has its own top level)
common=$(git rev-parse --path-format=absolute --git-common-dir)
root=$(dirname "$common")
home="$root/.preview"
state="$home/state"
pidfile="$home/pid"
branchfile="$home/branch"
log="$home/dev.log"

running() {
  [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

url() {
  local name
  name=$(tailscale status --json | jq -r '.Self.DNSName // empty' | sed 's/\.$//')
  [[ -n "$name" ]] && echo "https://$name" || echo "(the machine's ts.net name: tailscale is not connected)"
}

stop() {
  tailscale serve --https=443 off >/dev/null 2>&1 || true
  if running; then
    # The server was started in its own session (setsid): its pid is the process group's
    kill -- "-$(cat "$pidfile")" 2>/dev/null || true
    echo "Stopped the preview of $(cat "$branchfile" 2>/dev/null || echo '?')."
  fi
  rm -f "$pidfile" "$branchfile"
}

# The worktree where the branch is checked out; made (in .claude/worktrees) if it is nowhere yet
worktree_for() {
  local branch=$1 dir
  dir=$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '
    /^worktree / { wt = substr($0, 10) } $0 == "branch " b { print wt; exit }')
  if [[ -n "$dir" ]]; then
    echo "$dir"
    return
  fi
  dir="$root/.claude/worktrees/preview-${branch//\//-}"
  git fetch --quiet origin "$branch" >&2
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git worktree add --quiet "$dir" "$branch" >&2
  else
    git worktree add --quiet -b "$branch" "$dir" "origin/$branch" >&2
  fi
  echo "$dir"
}

case "${1:-}" in
  start)
    branch=${2:?usage: preview.sh start <branch>}
    command -v tailscale >/dev/null || { echo "tailscale is not installed." >&2; exit 1; }
    tailscale status >/dev/null 2>&1 || { echo "tailscale is not connected." >&2; exit 1; }
    mkdir -p "$home"
    stop
    # Seeded once, then kept: the test account and Team made on the preview stay for every branch
    if [[ ! -d "$state" ]]; then
      echo "No database yet: the first sign-in makes an empty one (to start from this machine's dev one, run" >&2
      echo "'just branch-preview-snapshot' first). Carrying on." >&2
      mkdir -p "$state"
    fi
    # Something else (a `just serve`) on the port would answer the check below, and be served as the branch
    if curl -s -o /dev/null --max-time 2 "http://localhost:$port/"; then
      echo "Port $port is already in use (a 'just serve' running?): stop it, then run this again." >&2
      exit 1
    fi
    dir=$(worktree_for "$branch")
    cd "$dir"
    [[ -d node_modules ]] || npm ci
    # What a checkout does not carry: the dev secrets (git-ignored), and the database
    [[ -e .dev.vars ]] || ln -s "$root/.dev.vars" .dev.vars
    mkdir -p .wrangler
    rm -rf .wrangler/state
    ln -s "$state" .wrangler/state
    # The branch's own migrations (idempotent). A branch left for an older one keeps them applied
    npx wrangler d1 migrations apply DB --local --env dev >/dev/null
    CHORDLESS_PORT=$port CHORDLESS_ALLOWED_HOSTS="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')" \
      setsid npm run dev >"$log" 2>&1 &
    echo $! >"$pidfile"
    echo "$branch" >"$branchfile"
    for _ in $(seq 1 60); do
      running || { echo "The server did not start; see $log" >&2; exit 1; }
      curl -sf -o /dev/null "http://localhost:$port/" && break
      sleep 1
    done
    tailscale serve --bg --https=443 "http://localhost:$port" >/dev/null
    echo "Serving $branch ($dir) at $(url)"
    echo "If the page does not load after going back to an older branch, clear the site's data (it may have a newer database)."
    ;;
  stop)
    stop
    ;;
  status)
    if running; then
      echo "Serving $(cat "$branchfile") at $(url) (log: $log)"
    else
      echo "No preview is running."
    fi
    ;;
  snapshot)
    [[ -d "$root/.wrangler/state" ]] || { echo "No dev database at $root/.wrangler/state (run 'just serve' first)." >&2; exit 1; }
    if [[ -d "$state" && -n "$(ls -A "$state")" && "${2:-}" != "--force" ]]; then
      echo "$state already holds a database; 'preview.sh snapshot --force' replaces it." >&2
      exit 1
    fi
    running && { echo "Stop the preview first (just branch-preview-stop)." >&2; exit 1; }
    mkdir -p "$home"
    rm -rf "$state"
    cp -a "$root/.wrangler/state" "$state"
    echo "Seeded $state from this machine's dev database."
    ;;
  *)
    echo "usage: preview.sh start <branch> | stop | status | snapshot [--force]" >&2
    exit 2
    ;;
esac
