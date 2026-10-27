#!/usr/bin/env bash
# Run once in an agent VM after it is made (docs/AGENT_VMS.md), as the user, in the checkout:
# the tools mise.toml pins, the packages, Playwright's browser and its system libraries, and
# pushing to GitHub over https with GH_TOKEN (the VM has no SSH key).
set -euo pipefail

mise trust
mise install
npm ci
# The libraries need root. Root gets Node's own directory first on PATH: not the user's mise shims,
# which read the user's mise config, and root does not trust that
sudo env "PATH=$(dirname "$(mise which node)"):$PATH" npx playwright install-deps chromium
npx playwright install chromium

git config --global url."https://github.com/".insteadOf "git@github.com:"
gh auth setup-git
