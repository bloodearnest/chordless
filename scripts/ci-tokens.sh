#!/usr/bin/env bash
# The R2 credentials CI's Terraform jobs read the state with (infra/README.md, docs/CI.md):
#   infra        Object Read            plans and the drift check
#   infra-apply  Object Read & Write    applies, after approval
# each a Cloudflare token limited to the state bucket, given to the GitHub environment as an S3 key
# pair (AWS_ACCESS_KEY_ID: the token's id; AWS_SECRET_ACCESS_KEY: the SHA-256 of the token). No value
# is shown or written to a file: each goes from Cloudflare's answer straight to `gh secret set`.
#
# The tokens are the account's (Account API Tokens), not a person's, so they outlive anyone's login.
# It needs a throwaway account token that can make tokens (Account API Tokens: Edit; an hour's life,
# your IP only), bare in the git-ignored .cloudflare-bootstrap-token: delete it in the dashboard
# afterwards. And a gh login that can set the repository's secrets.
#
#   scripts/ci-tokens.sh create   make both tokens (expiring in a year) and set the secrets
#   scripts/ci-tokens.sh rotate   give both tokens new values (Cloudflare "rolls" them: same id and
#                                 permissions) and set the secrets again
set -euo pipefail
cd "$(dirname "$0")/.."

ACCOUNT=589e207ea16d7e9db96c2b3d2ae87833
BUCKET=chordless-tfstate
REPOSITORY=bloodearnest/chordless
API=https://api.cloudflare.com/client/v4/accounts/$ACCOUNT
# The names the tokens have in Cloudflare's dashboard, which is how `rotate` finds them again
declare -A NAME=([infra]="chordless CI: Terraform state, read" [infra-apply]="chordless CI: Terraform state, read and write")
declare -A PERMISSIONS=([infra]="Workers R2 Storage Bucket Item Read" [infra-apply]="Workers R2 Storage Bucket Item Write")

mode=${1:-}
[[ $mode == create || $mode == rotate ]] || { echo "Usage: $0 create|rotate"; exit 2; }
[ -s .cloudflare-bootstrap-token ] || { echo "No .cloudflare-bootstrap-token (infra/README.md)"; exit 1; }
BOOTSTRAP=$(<.cloudflare-bootstrap-token)

cf() {
  local method=$1 path=$2 body=${3:-}
  local answer
  answer=$(curl -sS -X "$method" "$API$path" -H "Authorization: Bearer $BOOTSTRAP" \
    -H "Content-Type: application/json" ${body:+--data "$body"})
  if [ "$(jq -r .success <<<"$answer")" != true ]; then
    echo "Cloudflare: $method $path: $(jq -c .errors <<<"$answer")" >&2
    return 1
  fi
  printf '%s' "$answer"
}

# Set an environment's two secrets from a token's id and value (from stdin, so never in argv)
set_secrets() {
  local environment=$1 id=$2 value
  value=$(cat)
  gh secret set AWS_ACCESS_KEY_ID --repo "$REPOSITORY" --env "$environment" --body "$id"
  printf %s "$value" | sha256sum | cut -d' ' -f1 |
    gh secret set AWS_SECRET_ACCESS_KEY --repo "$REPOSITORY" --env "$environment"
  echo "$environment: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY set"
}

existing=$(cf GET "/tokens?per_page=50")
for environment in infra infra-apply; do
  name=${NAME[$environment]}
  id=$(jq -r --arg name "$name" '.result[] | select(.name == $name) | .id' <<<"$existing" | head -1)
  case $mode in
    create)
      [ -z "$id" ] || { echo "\"$name\" already exists ($id): rotate it instead"; exit 1; }
      group=$(cf GET /tokens/permission_groups |
        jq -r --arg name "${PERMISSIONS[$environment]}" '.result[] | select(.name == $name) | .id')
      [ -n "$group" ] || { echo "No permission group \"${PERMISSIONS[$environment]}\""; exit 1; }
      body=$(jq -n --arg name "$name" --arg group "$group" \
        --arg bucket "com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_${BUCKET}" \
        --arg expires "$(date -u -d '+1 year' +%Y-%m-%dT%H:%M:%SZ)" '{
          name: $name, expires_on: $expires,
          policies: [{effect: "allow", permission_groups: [{id: $group}], resources: {($bucket): "*"}}]
        }')
      answer=$(cf POST /tokens "$body")
      jq -r .result.value <<<"$answer" | set_secrets "$environment" "$(jq -r .result.id <<<"$answer")"
      # (not a secret: when it runs out, which the Terraform jobs warn of: scripts/ci/check-expiry.sh)
      gh variable set R2_TOKEN_EXPIRES --repo "$REPOSITORY" --env "$environment" \
        --body "$(jq -r .result.expires_on <<<"$answer")"
      echo "  \"$name\" made, expiring $(jq -r .result.expires_on <<<"$answer")"
      ;;
    rotate)
      [ -n "$id" ] || { echo "No token \"$name\": create it first"; exit 1; }
      cf PUT "/tokens/$id/value" '{}' | jq -r .result | set_secrets "$environment" "$id"
      echo "  \"$name\" rolled"
      ;;
  esac
done
echo "Done: delete the bootstrap token in the dashboard, and .cloudflare-bootstrap-token"
