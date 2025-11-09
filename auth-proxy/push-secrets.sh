#!/bin/bash

# Push secrets from .env to Cloudflare Workers
# Usage: ./push-secrets.sh

set -e  # Exit on error

# Load .env file
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
else
  echo "❌ Error: .env file not found"
  echo "Create .env with:"
  echo "  JWE_ENCRYPTION_KEY=..."
  echo "  GOOGLE_CLIENT_ID=..."
  echo "  GOOGLE_CLIENT_SECRET=..."
  echo "  GOOGLE_REDIRECT_URI=..."
  exit 1
fi

# Validate required variables
if [ -z "$JWE_ENCRYPTION_KEY" ] || [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$GOOGLE_CLIENT_SECRET" ] || [ -z "$GOOGLE_REDIRECT_URI" ]; then
  echo "❌ Error: Missing required environment variables in .env"
  exit 1
fi

# Push each secret to Wrangler (top-level environment)
echo "📤 Pushing secrets to Cloudflare Workers..."

echo "$JWE_ENCRYPTION_KEY" | npx wrangler secret put JWE_ENCRYPTION_KEY --env=""
echo "$GOOGLE_CLIENT_ID" | npx wrangler secret put GOOGLE_CLIENT_ID --env=""
echo "$GOOGLE_CLIENT_SECRET" | npx wrangler secret put GOOGLE_CLIENT_SECRET --env=""
echo "$GOOGLE_REDIRECT_URI" | npx wrangler secret put GOOGLE_REDIRECT_URI --env=""

echo ""
echo "✅ All secrets pushed successfully!"
echo ""
echo "Next steps:"
echo "  1. Copy .env to .dev.vars for local development"
echo "  2. Run 'npm run dev' to test locally"
echo "  3. Run 'npm run deploy' to deploy to Cloudflare"
