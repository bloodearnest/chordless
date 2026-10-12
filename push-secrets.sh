#!/bin/bash
# Push secrets from .dev.vars to the production Worker (the top-level environment)
# Usage: ./push-secrets.sh

set -e

if [ ! -f .dev.vars ]; then
  echo "Error: .dev.vars not found"
  exit 1
fi

export $(grep -v '^#' .dev.vars | xargs)

if [ -z "$JWE_ENCRYPTION_KEY" ] || [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$GOOGLE_CLIENT_SECRET" ] || [ -z "$GOOGLE_API_KEY" ]; then
  echo "Error: Missing required variables in .dev.vars"
  exit 1
fi

echo "Pushing secrets to Cloudflare Workers..."
echo "$JWE_ENCRYPTION_KEY"   | npx wrangler secret put JWE_ENCRYPTION_KEY --env=""
echo "$GOOGLE_CLIENT_ID"     | npx wrangler secret put GOOGLE_CLIENT_ID --env=""
echo "$GOOGLE_CLIENT_SECRET" | npx wrangler secret put GOOGLE_CLIENT_SECRET --env=""
echo "$GOOGLE_API_KEY"       | npx wrangler secret put GOOGLE_API_KEY --env=""

echo "Done."
