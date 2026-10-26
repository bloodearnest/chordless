#!/usr/bin/env bash
# The repository's merge settings, as GitHub has them, for the `check` in main.tf. Read over GraphQL:
# the REST API that the provider reads them from leaves them out for a token that cannot push to the
# repository, which CI's read-only plan token cannot. Terraform's external data source protocol: a JSON
# object on stdin ({"owner", "repository"}), a JSON object of strings on stdout. The token is
# GITHUB_TOKEN, as for the provider; it is never in what Terraform is given back, or keeps.
set -euo pipefail

input=$(cat)
owner=$(jq -r .owner <<<"$input")
repository=$(jq -r .repository <<<"$input")

# shellcheck disable=SC2016 # (GraphQL's variables, not the shell's)
query='query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed allowUpdateBranch
    deleteBranchOnMerge
  }
}'
body=$(jq -n --arg query "$query" --arg owner "$owner" --arg name "$repository" \
  '{query: $query, variables: {owner: $owner, name: $name}}')

response=$(curl -sS --fail-with-body -H "Authorization: Bearer ${GITHUB_TOKEN:?}" \
  -H "Content-Type: application/json" -d "$body" https://api.github.com/graphql)
if ! jq -e '.data.repository and (.errors | not)' >/dev/null <<<"$response"; then
  echo "GitHub's GraphQL API: $(jq -c '.errors // .' <<<"$response")" >&2
  exit 1
fi
jq '.data.repository | map_values(tostring)' <<<"$response"
