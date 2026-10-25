#!/usr/bin/env bash
# Check the GitHub workflows and actions in .github/ (`just lint-actions`; docs/CI.md):
# - actionlint: the workflow syntax, expressions, and the shell in `run:` steps (with shellcheck)
# - zizmor: security audits (template injection, permissions, credentials left in checkouts, cache
#   poisoning, actions not pinned by SHA), and online, with a GitHub token, `impostor-commit`: a
#   pinned SHA must be on a branch or tag of the action's own repository, not only in a fork
# The tools are pinned in mise.toml.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d .github ] || { echo "No .github/ to check"; exit 0; }

mise exec -- actionlint

# zizmor's online audits need a token: CI's GITHUB_TOKEN, or the gh login locally
if [ -z "${GH_TOKEN:-}" ]; then
  GH_TOKEN=$(gh auth token 2>/dev/null) || {
    echo "zizmor: no GH_TOKEN and no gh login, so the online audits (impostor-commit) are skipped"
    exec mise exec -- zizmor --offline .github
  }
  export GH_TOKEN
fi
mise exec -- zizmor .github
