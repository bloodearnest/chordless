#!/usr/bin/env bash
# Terraform on one stack of infra/, by hand, with the credentials each needs (infra/README.md):
#   scripts/tf.sh <stack> <terraform arguments>      e.g. scripts/tf.sh google-ci plan -out /tmp/x.plan
#   just tf <stack> <terraform arguments>
# The state is in R2: its key pair is made from the Cloudflare token in the git-ignored
# .cloudflare-token (the primary checkout's, from a worktree too), as infra-check.sh does, unless
# AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set already. The stack's own: the Cloudflare token
# (cloudflare), a gcloud sign-in (google-*; `mise exec -- gcloud auth login` first), the gh login (github).
set -euo pipefail
cd "$(dirname "$0")/.."

stack=${1:?Usage: scripts/tf.sh <stack> <terraform arguments>}
shift
[ -d "infra/$stack" ] || { echo "No stack infra/$stack ($(cd infra && echo */ | tr -d /))" >&2; exit 2; }

token_file="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/.cloudflare-token"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -s "$token_file" ]; then
  CLOUDFLARE_API_TOKEN=$(<"$token_file")
  export CLOUDFLARE_API_TOKEN
fi

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { echo "The state is in R2: no .cloudflare-token (infra/README.md)" >&2; exit 1; }
  # A Cloudflare token that can use R2 is its own S3 key: the id is the token's, the secret its SHA-256
  AWS_ACCESS_KEY_ID=$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    https://api.cloudflare.com/client/v4/user/tokens/verify | jq -er .result.id) ||
    { echo "Cloudflare does not accept the token in $token_file" >&2; exit 1; }
  AWS_SECRET_ACCESS_KEY=$(printf %s "$CLOUDFLARE_API_TOKEN" | sha256sum | cut -d' ' -f1)
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
fi

case $stack in
  google-*)
    GOOGLE_OAUTH_ACCESS_TOKEN=$(mise exec -- gcloud auth print-access-token 2>/dev/null) ||
      { echo "Not signed in to Google: mise exec -- gcloud auth login" >&2; exit 1; }
    export GOOGLE_OAUTH_ACCESS_TOKEN
    ;;
  github)
    GITHUB_TOKEN=${GITHUB_TOKEN:-$(gh auth token)}
    export GITHUB_TOKEN
    ;;
esac

exec mise exec -- terraform -chdir="infra/$stack" "$@"
