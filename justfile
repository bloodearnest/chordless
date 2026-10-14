# Chordless development commands

# Default recipe - show available commands
default:
    @just --list

# Run all tests: node, browser unit (Web Test Runner) and Playwright, then record the results
test: test-node test-unit test-browser-headless && stats

# Record the last full run's counts, times and coverage in docs/stats.jsonl (`just test` does it)
stats:
    node scripts/stats.ts

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

# Format project files with Biome
format:
    @echo "Formatting with Biome..."
    npx @biomejs/biome format --write .

# Browser unit test coverage of the app's code: a summary, and coverage/index.html.
# Only files the tests load are counted, so untested modules don't show at all
coverage:
    npx web-test-runner --config web-test-runner.config.js --coverage

# Run the node tests (the workers, email and share code, event names); coverage is of worker/src only,
# as the rest of src/ is measured by the browser suites
test-node:
    @mkdir -p .stats
    node --test --experimental-test-coverage --test-coverage-include='worker/src/**' --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=.stats/node.junit.xml --test-reporter=lcov --test-reporter-destination=.stats/node.lcov "tests/*.node.test.{js,ts}"

serve:
    npm run dev

# Build the app and the Worker into dist/
build:
    npm run build

# Serve the build in dist/ on port 8788
preview: build
    npm run preview -- --port 8788

deploy:
    npm run deploy

secrets:
    bash push-secrets.sh

# Keep the same URL: browser data (IndexedDB, sign-in) is tied to that origin.
# Expose local server via Tailscale Funnel on https://<machine>.<tailnet>.ts.net (port 443)
funnel:
    @tailscale funnel status 2>/dev/null | grep -q "8787" \
        && tailscale funnel status \
        || sudo tailscale funnel --bg 8787

# Run browser tests with Playwright (headless), optionally with files/options: just test-browser-headless tests/live.playwright.ts --repeat-each=5
test-browser-headless *args:
    @echo "Running browser tests with Playwright..."
    @if [ ! -d "node_modules" ]; then echo "Installing dependencies..."; npm install; fi
    {{ if args == "" { "PLAYWRIGHT_JSON_OUTPUT_NAME=.stats/e2e.json npx playwright test --reporter=list,json" } else { "npx playwright test " + args } }}

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

# Install Playwright and browsers
install-playwright:
    @echo "Installing Playwright dependencies..."
    npm install
    @echo "Installing Chromium browser..."
    npx playwright install chromium
