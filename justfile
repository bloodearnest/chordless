# Chordless development commands

# CI's Windows job runs recipes with the runner's Git Bash, as Linux and macOS do with sh
set windows-shell := ["bash", "-c"]

# Default recipe - show available commands
default:
    @just --list

# Run all tests: node and browser unit (Web Test Runner) in the background, while the Help pictures
# are retaken and then Playwright runs (scripts/test-all.sh); then record the results
test: && coverage-check stats
    scripts/test-all.sh

# Record the last full run's counts, times and coverage in docs/stats.jsonl (`just test` does it)
stats:
    node scripts/stats.ts

# End of a session: fast-forward the primary checkout's main to origin, and list the worktrees
# and branches whose PR has merged (`just wrap-up --prune` removes them). Run it in your own shell
wrap-up *args:
    scripts/wrap-up.sh {{args}}

# Run browser unit tests, optionally just some files: just test-unit tests/db.test.ts
# (a full run also measures coverage and leaves its results for `just stats`)
test-unit *args:
    @echo "Running browser unit tests with Web Test Runner..."
    @{{ if args == "" { "STATS=1 npm run test:web -- --coverage" } else { "npm run test:web -- " + args } }}

# Lint JS/JSON files with Biome (fast!)
lint:
    @echo "Running Biome check..."
    npx @biomejs/biome check .
    @echo "Running the TypeScript check..."
    npx tsc -b
    @just lint-infra
    @just lint-actions
    @just audit
    @echo "Running knip (unused files, exports and dependencies)..."
    npx knip --no-progress
    @echo "Checking wrangler.toml (a warning fails)..."
    scripts/lint-wrangler.sh

# Check the Terraform stacks: format and validity, no credentials needed (CI runs it when infra/ changes)
lint-infra:
    @echo "Checking the Terraform stacks (format, validity)..."
    scripts/infra-check.sh lint

# Check the GitHub workflows: actionlint (with shellcheck), and zizmor's security audits, which
# include that every pinned action's SHA is on a branch or tag of its repository (docs/CI.md)
lint-actions:
    @echo "Checking the GitHub workflows (actionlint, zizmor)..."
    scripts/lint-actions.sh

# Check the npm packages: the registry's signatures and provenance, and no known high advisory in
# a production dependency (the dev tools' are listed, not failed: scripts/audit-deps.sh)
audit:
    @echo "Checking the npm packages (signatures, advisories)..."
    scripts/audit-deps.sh

# DAST: ZAP's passive baseline scan of a site (needs Docker), as CI runs weekly: just zap
# http://localhost:8788 scans `just preview`. The report is left in zap-report/ (docs/CI.md)
zap target="https://chordless.app":
    scripts/zap-baseline.sh {{target}}

# The GitHub environments have the secrets the workflows use, by name (docs/CI.md)
check-gh-secrets:
    node scripts/check-gh-secrets.ts

# What CI's Linux jobs run, in order, writing no file in the repository: `just ci` before pushing
# a branch reproduces a PR's checks (docs/CI.md). The macOS and Windows jobs are `just test-e2e webkit|msedge`
ci:
    #!/usr/bin/env bash
    set -euo pipefail
    state() { git status --porcelain; git diff | git hash-object --stdin; }
    before=$(state)
    # test-unit takes its own arguments, so on one command line it would swallow what follows it
    just lint test-node
    just test-unit
    just coverage-check
    just test-e2e chromium
    if [ "$(state)" != "$before" ]; then
        echo "The checks changed files in the repository, which CI's must not:"
        git status --short
        exit 1
    fi

# Format project files with Biome
format:
    @echo "Formatting with Biome..."
    npx @biomejs/biome format --write .

# Coverage of the app's code by the node and browser unit tests together: a summary, the files with
# the most missing, and a failure if any file has more missing than docs/coverage-floor.json allows
# (it lowers the floor when coverage goes up). Detail of one file: node scripts/coverage.ts src/js/db.ts
# The browser report alone is in coverage/index.html
coverage: test-node test-unit coverage-check

# Check the coverage left by the last full node and browser unit runs (`just test` does it)
coverage-check:
    node scripts/coverage.ts

# Run the node tests (the workers, email and share code, event names). Coverage is of worker/src and
# of the src/ code they run, which `just coverage` adds to the browser suites
test-node:
    @mkdir -p .stats
    node --test --experimental-test-coverage --test-coverage-include='worker/src/**' --test-coverage-include='src/**' --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=.stats/node.junit.xml --test-reporter=lcov --test-reporter-destination=.stats/node.lcov "tests/*.node.test.{js,ts}"

serve:
    npm run dev

# The same, for trying live sync (docs/LIVE_SYNC.md): the Worker is its own process (wrangler dev), as the
# Vite plugin cannot pass WebSockets to it. Slower to start and heavier; `just serve` is for everything else
serve-live:
    scripts/serve-live.sh

# Build the app and the Worker into dist/
build:
    npm run build

# Serve the build in dist/ on port 8788
preview: build
    npm run preview -- --port 8788

# Write .dev.vars for local development from gcloud and Terraform (docs/ENVIRONMENTS.md)
dev-vars:
    node scripts/dev-vars.ts

# Before a deploy: the Terraform stacks match what is real, and the production Worker has its
# secrets (needs gcloud and CLOUDFLARE_API_TOKEN: infra/README.md; INFRA_DRIFT_SKIP="cloudflare" leaves a stack out)
predeploy:
    scripts/infra-check.sh drift
    node scripts/check-prod-secrets.ts

deploy: predeploy
    npm run deploy

# Keep the same URL: browser data (IndexedDB, sign-in) is tied to that origin.
# Expose local server via Tailscale Funnel on https://<machine>.<tailnet>.ts.net (port 443)
funnel:
    @tailscale funnel status 2>/dev/null | grep -q "8787" \
        && tailscale funnel status \
        || sudo tailscale funnel --bg 8787

# Retake the pictures the Help pages show (public/help/), from the real app, light and dark, so they
# follow how the controls look. `just test` does it: commit what changes
help-images:
    npx playwright test --config=playwright.help-images.config.ts

# The real-Drive suite (docs/DRIVE_TESTS.md): random histories of several devices syncing through a
# real Google Drive folder, to find what the in-memory fake cannot. Not part of `just test`. Needs
# the test account's credentials in .drive-test.env. Which histories: DRIVE_SEEDS=1-5 DRIVE_STEPS=30
# DRIVE_DEVICES=3 DRIVE_MODES=owner,concurrent just test-drive
test-drive *args:
    node --env-file-if-exists=.drive-test.env node_modules/.bin/web-test-runner --config web-test-runner.drive.config.js {{args}}

# Live sync of a share against the test account's real Drive and the real Worker (docs/LIVE_SYNC.md,
# docs/DRIVE_TESTS.md): a recipient is told of an update and fetches it, and how long that took. Needs
# .drive-test.env and, for the Drive key, .dev.vars. Not part of `just test` or CI
test-live-share:
    node --env-file-if-exists=.drive-test.env --env-file-if-exists=.dev.vars --test tests/drive/live-share.drive.node.test.ts

# Live sync in two real browsers (docs/LIVE_SYNC.md): one signed in as the test Google account, one
# with no account, on `just serve-live`'s server, with a real Drive. Needs .drive-test.env and .dev.vars.
# LIVE_DEBUG=1 prints what the pages log and say on their sockets. Not part of `just test` or CI
test-live *args:
    node --env-file-if-exists=.drive-test.env --env-file-if-exists=.dev.vars node_modules/.bin/playwright test --config playwright.live.config.ts {{args}}

# Get the refresh token for the real-Drive suite, signing in as the test account (docs/DRIVE_TESTS.md)
drive-test-login:
    node --env-file-if-exists=.drive-test.env scripts/drive-test-login.ts

# Run browser tests with Playwright (headless), optionally with files/options: just test-browser-headless tests/live.playwright.ts --repeat-each=5
test-browser-headless *args:
    @echo "Running browser tests with Playwright..."
    @if [ ! -d "node_modules" ]; then echo "Installing dependencies..."; npm install; fi
    {{ if args == "" { "PLAYWRIGHT_JSON_OUTPUT_NAME=.stats/e2e.json npx playwright test --reporter=list,json" } else { "npx playwright test " + args } }}

# Run the Playwright tests in one browser, chromium, webkit (Safari's engine), or chrome or msedge
# (Google's or Microsoft's own, as installed), as CI does: just test-e2e webkit tests/app.playwright.ts
test-e2e browser *args:
    CHORDLESS_BROWSER={{browser}} npx playwright test {{args}}

# Run the browser tests in WebKit (Safari's engine) instead of Chromium; opt-in, as it is slow: just test-webkit tests/app.playwright.ts
test-webkit *args:
    @if [ ! -d "node_modules" ]; then echo "Installing dependencies..."; npm install; fi
    npx playwright test --project=webkit --project=built-webkit {{args}}

# Run browser tests with Playwright UI
test-browser-ui:
    @echo "Running browser tests with Playwright UI..."
    @if [ ! -d "node_modules" ]; then echo "Installing dependencies..."; npm install; fi
    npx playwright test --ui

# Run browser tests in headed mode (visible browser)
test-browser-headed:
    @echo "Running browser tests in headed mode..."
    @if [ ! -d "node_modules" ]; then echo "Installing dependencies..."; npm install; fi
    npx playwright test --headed

# First-time setup: npm dependencies, and Chromium for the browser tests
setup: install-playwright

# Install WebKit for `just test-webkit` (on Linux, add --with-deps for the system libraries; needs sudo)
install-webkit:
    npx playwright install webkit

# Install Playwright and browsers
install-playwright:
    @echo "Installing Playwright dependencies..."
    npm install
    @echo "Installing Chromium browser..."
    npx playwright install chromium
