#!/usr/bin/env bash
set -euo pipefail
CERT_DIR="certs"
CERT_PATH="$CERT_DIR/dev.crt"
KEY_PATH="$CERT_DIR/dev.key"
mkdir -p "$CERT_DIR"
openssl req -x509 -nodes -newkey rsa:4096 -sha256 -days 365 \
  -keyout "$KEY_PATH" -out "$CERT_PATH" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
echo "Generated $CERT_PATH and $KEY_PATH"
echo "To trust on Linux: sudo ./scripts/install-dev-cert.sh"
