#!/usr/bin/env bash
# The Cloudflare credentials CI's Terraform jobs use (infra/README.md, docs/CI.md), per environment:
#   infra        plans and the drift check          infra-apply  applies, after approval
# 1. R2 credentials for the state: a token limited to the state bucket, Object Read (infra) or Object
#    Read & Write (infra-apply), given as an S3 key pair (AWS_ACCESS_KEY_ID: the token's id;
#    AWS_SECRET_ACCESS_KEY: the SHA-256 of the token).
# 2. CLOUDFLARE_API_TOKEN, for the `cloudflare` stack: read (infra) or edit (infra-apply) of what that
#    stack holds, and nothing else: Workers Scripts and R2 on the account, and Workers Routes, DNS,
#    Zone Settings, Zone and Email Routing Rules on the chordless.app zone.
# No value is shown or written to a file: each goes from Cloudflare's answer straight to `gh secret set`.
#
# The tokens are the account's (Account API Tokens), not a person's, so they outlive anyone's login.
# It needs a throwaway account token that can make tokens (Account API Tokens: Edit; an hour's life,
# your IP only), bare in the git-ignored .cloudflare-bootstrap-token (the primary checkout's, from a
# worktree too): delete it in the dashboard afterwards. `bootstrap` helps make it. And a gh login that
# can set the repository's secrets. About once a year (when the tokens are rotated).
#
#   scripts/ci-tokens.sh bootstrap [create|rotate]
#                                 open the dashboard to make the bootstrap token (the permission and
#                                 an hour's life filled in), take its pasted value without showing it,
#                                 keep it in the file, check it, then run create (or rotate)
#   scripts/ci-tokens.sh create   make the tokens (expiring in a year) and set the secrets; one that
#                                 exists is left as it is
#   scripts/ci-tokens.sh rotate   give the tokens new values (Cloudflare "rolls" them: same id and
#                                 permissions) and set the secrets again
set -euo pipefail
cd "$(dirname "$0")/.."
# (the primary checkout's, so a worktree finds it too)
BOOTSTRAP_FILE=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/.cloudflare-bootstrap-token

ACCOUNT=589e207ea16d7e9db96c2b3d2ae87833
ZONE=03ecba88194d19b6e9998db7e04bd95d
BUCKET=chordless-tfstate
REPOSITORY=bloodearnest/chordless
API=https://api.cloudflare.com/client/v4/accounts/$ACCOUNT
# The names the tokens have in Cloudflare's dashboard, which is how `rotate` finds them again
declare -A NAME=([infra]="chordless CI: Terraform state, read" [infra-apply]="chordless CI: Terraform state, read and write")
declare -A PERMISSIONS=([infra]="Workers R2 Storage Bucket Item Read" [infra-apply]="Workers R2 Storage Bucket Item Write")

mode=${1:-}

if [ "$mode" = bootstrap ]; then
  # The dashboard's token form, filled in by its URL (Cloudflare's token templates, documented at
  # developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/): an account
  # token takes only the permission and the name, so the rest is set by hand in the form (no
  # parameter for the expiry, the IP or the account), and checked below before the token
  # is kept: this account only, your IP only, an hour. If the permission is not filled in either,
  # make the token by hand: Account API Tokens, Create Custom Token, Account API Tokens: Edit.
  template='[{"key":"account_api_tokens","type":"edit"}]'
  expires=$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)
  url="https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=$(jq -rn --arg t "$template" '$t|@uri')&name=$(jq -rn --arg n "chordless bootstrap $(date -u +%F)" '$n|@uri')"
  echo "Make the token in the dashboard: Account API Tokens: Edit on this account only; Client IP Address Filtering:"
  echo "your IP ($(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || echo 'ask your IP')); TTL: an end date within the hour (before $expires)."
  echo "$url"
  (xdg-open "$url" || open "$url") >/dev/null 2>&1 || echo "(open that address in a browser)"
  read -rsp "Paste the token (not shown): " value
  echo
  [ -n "$value" ] || { echo "Nothing pasted"; exit 1; }
  # It must be a live token before it is kept
  answer=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/tokens/verify" -H "Authorization: Bearer $value")
  [ "$(jq -r .result.status <<<"$answer")" = active ] || { echo "Cloudflare does not accept it: $(jq -c .errors <<<"$answer")"; exit 1; }
  # It must be the throwaway kind asked for, not a broad or long one: checked from Cloudflare's own
  # description of it (what the form was given), before it is kept
  id=$(jq -r .result.id <<<"$answer")
  ends=$(jq -r '.result.expires_on // empty' <<<"$answer")
  details=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/tokens/$id" -H "Authorization: Bearer $value")
  problems=()
  if [ -z "$ends" ]; then problems+=("it never expires (set an end date within the hour)")
  elif [ "$(date -u -d "$ends" +%s)" -gt "$(date -u -d '+2 hours' +%s)" ]; then problems+=("it runs until $ends (an hour is enough)"); fi
  [ "$(jq -r '(.result.condition.request_ip.in // []) | length' <<<"$details")" -gt 0 ] || problems+=("it is not limited to an IP address")
  jq -e --arg a "com.cloudflare.api.account.$ACCOUNT" \
    '[.result.policies[]?.resources | keys[]] | length > 0 and all(. == $a)' <<<"$details" >/dev/null ||
    problems+=("it is not limited to this account")
  if [ ${#problems[@]} -gt 0 ]; then
    printf 'Not kept: %s\n' "${problems[@]}"
    echo "Delete that token in the dashboard, make another with those settings, and run this again."
    exit 1
  fi
  (umask 077 && printf %s "$value" >"$BOOTSTRAP_FILE")
  echo "Kept in $BOOTSTRAP_FILE (readable by you only). Delete the token in the dashboard, and that file, after."
  exec "$0" "${2:-create}"
fi

[[ $mode == create || $mode == rotate ]] || { echo "Usage: $0 bootstrap [create|rotate] | create | rotate"; exit 2; }
[ -s "$BOOTSTRAP_FILE" ] || { echo "No $BOOTSTRAP_FILE: scripts/ci-tokens.sh bootstrap makes it (infra/README.md)"; exit 1; }
BOOTSTRAP=$(<"$BOOTSTRAP_FILE")

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
      [ -z "$id" ] || { echo "\"$name\" exists: left as it is (rotate gives it a new value)"; continue; }
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

# The `cloudflare` stack's token: what it manages, read or edit. Names are Cloudflare's permission groups
# (GET /tokens/permission_groups); one that is missing is named, to change here.
declare -A CF_NAME=([infra]="chordless CI: Terraform cloudflare stack, read" [infra-apply]="chordless CI: Terraform cloudflare stack, edit")
declare -A CF_VERB=([infra]="Read" [infra-apply]="Write")
groups=$(cf GET /tokens/permission_groups)
group_id() { jq -er --arg name "$1" '.result[] | select(.name == $name) | .id' <<<"$groups" | head -1 ||
  { echo "No permission group \"$1\" (scripts/ci-tokens.sh)" >&2; return 1; }; }
for environment in infra infra-apply; do
  name=${CF_NAME[$environment]}
  verb=${CF_VERB[$environment]}
  id=$(jq -r --arg name "$name" '.result[] | select(.name == $name) | .id' <<<"$existing" | head -1)
  case $mode in
    create)
      [ -z "$id" ] || { echo "\"$name\" exists: left as it is (rotate gives it a new value)"; continue; }
      account_groups=$(jq -n --arg a "$(group_id "Workers Scripts $verb")" --arg b "$(group_id "Workers R2 Storage $verb")" \
        '[{id: $a}, {id: $b}]')
      zone_groups=$(jq -n --arg a "$(group_id "Workers Routes $verb")" --arg b "$(group_id "DNS $verb")" \
        --arg c "$(group_id "Zone Settings $verb")" --arg d "$(group_id "Zone Read")" \
        --arg e "$(group_id "Email Routing Rules $verb")" '[{id: $a}, {id: $b}, {id: $c}, {id: $d}, {id: $e}]')
      # (a name not found comes out as an empty id, as the lookups run in substitutions)
      jq -e 'all(.[]; .id != "")' <<<"$account_groups$zone_groups" >/dev/null || { echo "A permission group is missing: see above" >&2; exit 1; }
      body=$(jq -n --arg name "$name" --argjson account "$account_groups" --argjson zone "$zone_groups" \
        --arg account_resource "com.cloudflare.api.account.$ACCOUNT" \
        --arg zone_resource "com.cloudflare.api.account.zone.$ZONE" \
        --arg expires "$(date -u -d '+1 year' +%Y-%m-%dT%H:%M:%SZ)" '{
          name: $name, expires_on: $expires,
          policies: [
            {effect: "allow", permission_groups: $account, resources: {($account_resource): "*"}},
            {effect: "allow", permission_groups: $zone, resources: {($zone_resource): "*"}}
          ]
        }')
      answer=$(cf POST /tokens "$body")
      jq -r .result.value <<<"$answer" | gh secret set CLOUDFLARE_API_TOKEN --repo "$REPOSITORY" --env "$environment"
      gh variable set CLOUDFLARE_TOKEN_EXPIRES --repo "$REPOSITORY" --env "$environment" \
        --body "$(jq -r .result.expires_on <<<"$answer")"
      echo "  \"$name\" made, expiring $(jq -r .result.expires_on <<<"$answer")"
      ;;
    rotate)
      [ -n "$id" ] || { echo "No token \"$name\": create it first"; exit 1; }
      cf PUT "/tokens/$id/value" '{}' | jq -r .result | gh secret set CLOUDFLARE_API_TOKEN --repo "$REPOSITORY" --env "$environment"
      echo "  \"$name\" rolled"
      ;;
  esac
done
echo "Done: delete the bootstrap token in the dashboard, and $BOOTSTRAP_FILE"
