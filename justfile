# Setalight development commands

# Default recipe - show available commands
default:
    @just --list

# Run the development server
run:
    python3 api.py

# Run all tests
test: test-node test-browser-headless

# Run Node.js tests
test-node:
    @echo "Running Node.js tests..."
    node tests/transpose.test.js

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
