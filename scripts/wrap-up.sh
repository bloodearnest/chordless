#!/usr/bin/env bash
# End-of-session tidy-up (CLAUDE.md, "Branches and pull requests"): bring the primary checkout's
# main up to date with origin, and find the worktrees and branches whose pull request has merged.
#
#   scripts/wrap-up.sh            report only, besides fetching and fast-forwarding main
#   scripts/wrap-up.sh --prune    also remove the merged ones that have nothing uncommitted
#
# Run it from anywhere in the repository, in the user's own shell: a session confined to its
# worktree cannot touch the primary checkout. It also installs the packages (npm ci) if the lock file is
# newer than what is installed, which a pull that adds a dependency leaves behind. "Rebase and merge" gives a PR's commits new shas, so
# a merged branch is found by its PR (gh), not by git's ancestry, and is only removed when its tip
# is the commit the PR merged (nothing added since). Nothing is ever force-removed.
set -euo pipefail

prune=0
[[ "${1:-}" == "--prune" ]] && prune=1

# The first worktree git lists is the primary checkout
primary=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
git -C "$primary" fetch --prune --quiet origin

echo "main in $primary:"
current=$(git -C "$primary" branch --show-current)
if [[ "$current" != "main" ]]; then
  echo "  not on main (on '${current:-a detached head}'): left alone"
elif [[ -n "$(git -C "$primary" status --porcelain)" ]]; then
  echo "  has uncommitted changes: left alone"
elif git -C "$primary" merge --ff-only --quiet origin/main; then
  echo "  up to date with origin/main ($(git -C "$primary" rev-parse --short HEAD))"
  # A pull that changes package-lock.json leaves node_modules behind, and a build then fails to resolve
  # the new package. npm writes node_modules/.package-lock.json when it installs: older than the lock is stale.
  if [[ ! -e "$primary/node_modules/.package-lock.json" || "$primary/package-lock.json" -nt "$primary/node_modules/.package-lock.json" ]]; then
    echo "  node_modules is older than package-lock.json: npm ci"
    (cd "$primary" && npm ci --silent)
  fi
else
  echo "  has commits origin/main lacks: left alone"
fi

echo
echo "Branches whose pull request has merged:"
found=0
while read -r name; do
  [[ "$name" == "main" ]] && continue
  pr=$(gh pr list --state merged --head "$name" --json number,headRefOid --jq '.[0] // empty')
  [[ -z "$pr" ]] && continue
  found=1
  number=$(jq -r .number <<<"$pr")
  head=$(jq -r .headRefOid <<<"$pr")
  tree=$(git worktree list --porcelain | awk -v b="refs/heads/$name" '/^worktree /{w=$2} $1=="branch" && $2==b {print w}')
  if [[ "$(git rev-parse "$name")" != "$head" ]]; then
    echo "  $name (#$number): has commits the merged pull request lacked: kept"
  elif [[ -n "$tree" && -n "$(git -C "$tree" status --porcelain)" ]]; then
    echo "  $name (#$number): its worktree $tree has uncommitted changes: kept"
  elif ((prune)); then
    [[ -n "$tree" ]] && git worktree remove "$tree"
    git branch -D --quiet "$name"
    echo "  $name (#$number): removed${tree:+ with its worktree}"
  else
    echo "  $name (#$number): merged${tree:+, worktree $tree}"
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads/)
((found)) || echo "  none"
if ((!prune && found)); then
  echo
  echo "(--prune removes the merged ones listed above that are clean)"
fi
