# Chordless development commands

# Default recipe - show available commands
default:
    @just --list

# Run all tests: node, browser unit (Web Test Runner) and Playwright
test: test-node test-unit test-browser-headless

# Run browser unit tests, optionally just some files: just test-unit tests/db.test.js
test-unit *args:
    @echo "Running browser unit tests with Web Test Runner..."
    @npm run test:web -- {{args}}

# Lint JS/JSON files with Biome (fast!)
lint:
    @echo "Running Biome check..."
    npx @biomejs/biome check .

# Format project files with Biome
format:
    @echo "Formatting with Biome..."
    npx @biomejs/biome format --write .

# Browser unit test coverage of the app's code: a summary, and coverage/index.html.
# Only files the tests load are counted, so untested modules don't show at all
coverage:
    npx web-test-runner --config web-test-runner.config.js --coverage

# Run the node tests (the auth worker, event names)
test-node:
    npm run test:node

serve:
    npm run dev

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

# Run browser tests with Playwright (headless), optionally with files/options: just test-browser-headless tests/live.playwright.js --repeat-each=5
test-browser-headless *args:
    @echo "Running browser tests with Playwright..."
    @if [ ! -d "node_modules" ]; then echo "Installing dependencies..."; npm install; fi
    npx playwright test {{args}}

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
