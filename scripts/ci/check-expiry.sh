#!/usr/bin/env bash
# When the credentials of a Terraform job run out (.github/workflows/terraform.yml; infra/README.md):
#   the GitHub token: GitHub says, in a header of any answer to it
#   the R2 tokens: the environment's R2_TOKEN_EXPIRES variable, which scripts/ci-tokens.sh sets
# A warning from 30 days before; from 7, it fails, so the nightly run says so in time to rotate them
# (scripts/ci-tokens.sh rotate, and a regenerated GitHub token).
set -euo pipefail

now=$(date -u +%s)
status=0
check() {
  local what=$1 expires=$2 days
  if [ -z "$expires" ]; then
    echo "::warning::$what: no expiry known"
    return
  fi
  days=$(( ($(date -u -d "$expires" +%s) - now) / 86400 ))
  if [ "$days" -lt 7 ]; then
    echo "::error::$what runs out in $days days ($expires): rotate it (infra/README.md)"
    status=1
  elif [ "$days" -lt 30 ]; then
    echo "::warning::$what runs out in $days days ($expires): rotate it soon (infra/README.md)"
  else
    echo "$what: $days days left"
  fi
}

github=$(curl -sS -o /dev/null -D - -H "Authorization: Bearer ${GITHUB_TOKEN:?}" https://api.github.com/rate_limit |
  sed -nE 's/^github-authentication-token-expiration: (.*)\r?$/\1/Ip' | tr -d '\r')
check "The GitHub token (GH_TERRAFORM_TOKEN)" "$github"
check "The R2 token (AWS_ACCESS_KEY_ID)" "${R2_TOKEN_EXPIRES:-}"
exit $status
