import { defineConfig, devices } from '@playwright/test'

// The tests that use the real thing (docs/LIVE_SYNC.md, docs/DRIVE_TESTS.md): browsers signed in as the
// test Google account, the real Worker, and Drive. `just test-live`. Not part of `just test` or CI: they
// need the test account's credentials (.drive-test.env) and the dev secrets (.dev.vars), and call Google.
//
// Their server is `just serve-live` (the Worker is wrangler dev, which passes WebSockets), on ports of
// its own: 8787 is the development server's, and the other tests' are 8788 and 8791 to 8792.
const PORT = 8793
const WORKER_PORT = 8794

export default defineConfig({
  testDir: './tests/live',
  testMatch: '*.live.playwright.ts',
  timeout: 3 * 60 * 1000,
  // One at a time: they share one Google account, and Drive's quota is per user
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-GB',
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'scripts/serve-live.sh',
    env: { CHORDLESS_PORT: String(PORT), CHORDLESS_WORKER_PORT: String(WORKER_PORT) },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
})
