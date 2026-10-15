# Chordless development commands

# Default recipe - show available commands
default:
    @just --list

# Run all tests: node, browser unit (Web Test Runner) and Playwright, then record the results
test: test-node test-unit test-browser-headless && coverage-check stats

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
    @echo "Running knip (unused files, exports and dependencies)..."
    npx knip --no-progress

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
