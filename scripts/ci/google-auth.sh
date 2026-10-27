#!/usr/bin/env bash
# Sign in to Google for the Terraform stacks, with nothing stored (infra/google-ci; infra/README.md):
# GitHub gives the job an OIDC token (the job needs `id-token: write`), Google's STS trades it for a
# federated token if it is from this repository's job on main in the environment that account is
# for, and that token is traded for the access token of the service account. The access token is
# made GOOGLE_OAUTH_ACCESS_TOKEN for the later steps of the job (an hour; masked in the log).
# Third-party sign-in actions are not allowed (docs/CI.md), and these are three calls.
# Usage: scripts/ci/google-auth.sh plan|apply   (plan: the `infra` environment, apply: `infra-apply`)
set -euo pipefail

account=${1:?plan or apply}
case $account in plan | apply) ;; *) echo "Usage: $0 plan|apply" >&2; exit 2 ;; esac

# Not secret (infra/google-ci's outputs): the project number is the Picker app id
project=chordless-app
number=818185619377
audience="//iam.googleapis.com/projects/$number/locations/global/workloadIdentityPools/github/providers/github"
service_account="ci-$account@$project.iam.gserviceaccount.com"

: "${ACTIONS_ID_TOKEN_REQUEST_URL:?the job needs id-token: write}"
: "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:?the job needs id-token: write}"

# POST some JSON, with a bearer token if there is one (a header from stdin, so a token is never in a
# command line)
post() {
  local url=$1 bearer=$2 body=$3
  { [ -z "$bearer" ] || printf 'header = "Authorization: Bearer %s"\n' "$bearer"; } |
    curl -fsS --max-time 30 -K - -X POST "$url" -H 'Content-Type: application/json' --data "$body"
}

oidc=$(printf 'header = "Authorization: bearer %s"\n' "$ACTIONS_ID_TOKEN_REQUEST_TOKEN" |
  curl -fsS --max-time 30 -K - "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=$(jq -rn --arg a "$audience" '$a|@uri')" |
  jq -er .value)
echo "::add-mask::$oidc"

federated=$(post https://sts.googleapis.com/v1/token "" "$(jq -n --arg audience "$audience" --arg token "$oidc" '{
  grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
  audience: $audience,
  scope: "https://www.googleapis.com/auth/cloud-platform",
  requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
  subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
  subjectToken: $token
}')" | jq -er .access_token)
echo "::add-mask::$federated"

access=$(post "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/$service_account:generateAccessToken" \
  "$federated" '{"scope": ["https://www.googleapis.com/auth/cloud-platform"], "lifetime": "3600s"}' |
  jq -er .accessToken)
echo "::add-mask::$access"

echo "GOOGLE_OAUTH_ACCESS_TOKEN=$access" >>"${GITHUB_ENV:?not in CI}"
echo "Signed in to Google as $service_account"
