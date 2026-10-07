# Chordless development commands

# Default recipe - show available commands
default:
    @just --list

# Run all tests
test: test-unit

# Run browser unit tests
test-unit:
    @echo "Running browser unit tests with Web Test Runner..."
    @npm run test:web

# Lint/format JS files with Biome (fast!)
lint:
    @echo "Running Biome check..."
    npx @biomejs/biome check components js tests service-worker.js

# Format project files with Biome
format:
    @echo "Formatting with Biome..."
    npx @biomejs/biome format --write components js tests service-worker.js

# Copy vendored dependencies from node_modules to vendor/
vendor:
    node scripts/vendor-deps.mjs

serve:
    npm run dev

deploy:
    npm run deploy

secrets:
    bash push-secrets.sh

# Expose local server via Tailscale Funnel (HTTPS -> http://localhost:8787)
funnel:
    @tailscale funnel status 2>/dev/null | grep -q "8787" \
        && tailscale funnel status \
        || tailscale funnel 8787

# Run browser tests with Playwright (headless)
test-browser-headless:
    @echo "Running browser tests with Playwright..."
    @if [ ! -d "node_modules" ]; then echo "Installing dependencies..."; npm install; fi
    npx playwright test

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

# Install Playwright and browsers
install-playwright:
    @echo "Installing Playwright dependencies..."
    npm install
    @echo "Installing Chromium browser..."
    npx playwright install chromium

# Open browser tests manually (for development)
test-browser-manual:
    @echo "Opening browser tests..."
    @echo "Browser tests will open in your default browser"
    @echo "Check the browser console for test results"
    xdg-open http://localhost:8787/tests/template-test.html
    @sleep 1
    xdg-open http://localhost:8787/tests/test-sw.html
    @echo "✓ Browser tests opened"
    @echo "Note: Make sure the dev server is running (just serve)"
