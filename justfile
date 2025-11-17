# Setalight development commands

# Default recipe - show available commands
default:
    @just --list

# Run all tests
test: test-unit

# Run browser unit tests
test-unit:
    @echo "Running browser unit tests with Web Test Runner..."
    @npm run test:web

# Lint/format JS files (basic syntax checks)
lint:
    @echo "Checking formatting..."
    npx prettier --check .
    @echo "Running ESLint..."
    npx eslint components js tests service-worker.js auth-proxy/src

# Format project files with Prettier
format:
    @echo "Formatting with Prettier..."
    npx prettier --write .

# Copy vendored dependencies from node_modules to vendor/
vendor:
    node scripts/vendor-deps.mjs

serve:
    caddy run --config Caddyfile --watch

setup-dev-https:
    @bash scripts/setup-dev-https.sh

remove-dev-https:
    @bash scripts/remove-dev-https.sh

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
    xdg-open http://localhost:8000/tests/template-test.html
    @sleep 1
    xdg-open http://localhost:8000/tests/test-sw.html
    @echo "✓ Browser tests opened"
    @echo "Note: Make sure the dev server is running (just run)"
