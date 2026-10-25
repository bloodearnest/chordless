#!/bin/bash
# Checks on the Terraform stacks in infra/ (infra/README.md). Terraform is pinned in mise.toml.
#   lint   formatting and validity: needs no credentials (`just lint` runs it)
#   drift  the plan of each stack must say "No changes": needs credentials (`just deploy` runs it,
#          and CI's drift.yml nightly): the state's, in R2 (AWS_ACCESS_KEY_ID and
#          AWS_SECRET_ACCESS_KEY, the git-ignored .r2-tfstate.env, or made from CLOUDFLARE_API_TOKEN),
#          and each stack's own
# Usage: scripts/infra-check.sh lint|drift
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

tf() { mise exec -- terraform "$@"; }
failed=0

case "${1:-}" in
  lint)
    for dir in infra/*/; do
      name=$(basename "$dir")
      # A data directory of its own, with no backend: a stack's own .terraform, set up for its state
      # in R2, would want that state's credentials even for `init -backend=false`
      export TF_DATA_DIR="${TMPDIR:-/tmp}/chordless-terraform-lint/$name"
      if ! tf -chdir="$dir" fmt -check -diff; then
        echo "terraform fmt: $name is not formatted (terraform -chdir=$dir fmt)"; failed=1
      fi
      if ! tf -chdir="$dir" init -backend=false -input=false >/dev/null; then
        echo "terraform init: $name failed"; failed=1; continue
      fi
      tf -chdir="$dir" validate -no-color || failed=1
    done
    ;;
  drift)
    unset TF_DATA_DIR
    if [ -z "${AWS_ACCESS_KEY_ID:-}" ] && [ -f .r2-tfstate.env ]; then
      set -a
      # shellcheck source=/dev/null
      . ./.r2-tfstate.env
      set +a
    fi
    # Or from a Cloudflare API token that can use R2: its S3 key id is the token's id, and its secret
    # the SHA-256 of the token
    if [ -z "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
      AWS_ACCESS_KEY_ID=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        https://api.cloudflare.com/client/v4/user/tokens/verify | jq -r '.result.id // empty')
      AWS_SECRET_ACCESS_KEY=$(printf %s "$CLOUDFLARE_API_TOKEN" | sha256sum | cut -d' ' -f1)
      export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    fi
    if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
      echo "The state is in R2: set CLOUDFLARE_API_TOKEN (with R2 access), or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or write those in .r2-tfstate.env (infra/README.md)"
      exit 1
    fi
    # (INFRA_DRIFT_SKIP="cloudflare google-dev" leaves stacks out, for when you lack their credentials)
    for dir in infra/*/; do
      name=$(basename "$dir")
      case " ${INFRA_DRIFT_SKIP:-} " in *" $name "*) echo "skipping $name (INFRA_DRIFT_SKIP)"; continue;; esac
      case "$name" in
        cloudflare)
          if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
            echo "$name: set CLOUDFLARE_API_TOKEN (infra/README.md), or INFRA_DRIFT_SKIP=$name"; failed=1; continue
          fi;;
        google-*)
          GOOGLE_OAUTH_ACCESS_TOKEN=$(mise exec -- gcloud auth print-access-token 2>/dev/null) || {
            echo "$name: no gcloud sign-in (gcloud auth login), or INFRA_DRIFT_SKIP=$name"; failed=1; continue
          }
          export GOOGLE_OAUTH_ACCESS_TOKEN;;
        github)
          if [ -z "${GITHUB_TOKEN:-}" ]; then
            GITHUB_TOKEN=$(gh auth token 2>/dev/null) || {
              echo "$name: set GITHUB_TOKEN, or gh auth login, or INFRA_DRIFT_SKIP=$name"; failed=1; continue
            }
            export GITHUB_TOKEN
          fi;;
      esac
      tf -chdir="$dir" init -input=false >/dev/null || { failed=1; continue; }
      tf -chdir="$dir" plan -input=false -detailed-exitcode -no-color >/tmp/infra-plan-"$name".txt 2>&1
      case $? in
        0) echo "$name: no changes";;
        2) echo "$name: DRIFT (the plan has changes; see terraform -chdir=$dir plan):"
           grep -E "^\s*[#~+-] " /tmp/infra-plan-"$name".txt | head -20; failed=1;;
        *) echo "$name: the plan failed:"; tail -15 /tmp/infra-plan-"$name".txt; failed=1;;
      esac
    done
    ;;
  *) echo "Usage: $0 lint|drift"; exit 2;;
esac
exit $failed
