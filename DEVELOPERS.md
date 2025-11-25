# Chordless Development Guide

Chordless is designed to run exactly the same locally as it does in production: an HTTPS-only, service-worker-driven webapp served by Caddy with HTTP/2/3 enabled. Follow this guide to get your machine ready and to keep certificates in sync.

## Prerequisites

- [Caddy](https://caddyserver.com/) installed on your PATH (used by `just serve`).
- `openssl` for certificate generation.
- `sudo` access so the local CA can be added to `/usr/local/share/ca-certificates`.
- Optional but recommended: `certutil` (`libnss3-tools` on Debian/Ubuntu) so Chrome/Chromium trust the CA automatically.

## One-time setup per machine

```bash
# generate certs/certs/dev.(crt|key) + trust them system-wide and for Chrome
just setup-dev-https
```

What this does:

1. Generates `certs/dev.crt` and `certs/dev.key` if they do not already exist.
2. Copies the certificate into `/usr/local/share/ca-certificates/chordless-dev.crt` and runs `update-ca-certificates` (you will be prompted for sudo).
3. If `certutil` is available, adds/removes the `chordless-dev` CA entry inside Chrome/Chromium’s NSS database at `~/.pki/nssdb`.
4. Reminds you to restart browsers so they pick up the refreshed trust store.

To undo the setup (e.g., before rotating the certs or leaving the project), run:

```bash
just remove-dev-https
```

This removes the system CA entry, clears the Chrome/Chromium NSS entry, and deletes `certs/dev.*`.

## Daily workflow

```bash
# start Caddy with HTTP/1.1 + 2 + 3 on https://localhost:8443
just serve

# visit the app
open https://localhost:8443
```

Notes:

- The first visit registers the service worker; the page reloads automatically once it is active.
- Use DevTools Console and filter for `[SW]` to inspect service-worker logs.
- The importer and Google auth flows rely on HTTPS. Do not fall back to Python/Node static servers; they are unsupported.
