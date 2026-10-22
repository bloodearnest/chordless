import { defineConfig, devices } from '@playwright/test'

// The tests run their own servers, on ports of their own: 8787 is the development server's
// (the origin the browser's data belongs to) and 8788 is `just preview`'s, and a test run
// must never meet either
const DEV_PORT = 8791
const BUILT_PORT = 8792

// The built app is a `vite build` away: skip it when the run names test files, or the chromium
// project, and none of them is the built one (`just test-browser-headless tests/live.playwright.ts`)
const args = process.argv.slice(2)
const named = args.filter(a => /\.playwright\.|^--project/.test(a))
const needsBuilt =
  named.length === 0 ||
  named.some(a => /built|--project[= ]?built/.test(a)) ||
  args.includes('--ui')

// WebKit (Safari's engine) roughly doubles the run, so it is opt-in: `just test-webkit`, or
// --project=webkit. Plain runs, and `just test`, stay on Chromium
// (Workers get no command line, so the choice goes to them in the environment.)
if (args.some(a => /webkit/.test(a))) process.env.CHORDLESS_WEBKIT = '1'
const webkit = process.env.CHORDLESS_WEBKIT === '1'

export default defineConfig({
  testDir: './tests',
  testMatch: '*.playwright.{js,ts}',

  timeout: 30 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',

  use: {
    baseURL: `http://localhost:${DEV_PORT}`,
    // Dates follow the browser's locale; fix it so expectations are stable
    locale: 'en-GB',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: 'built.playwright.{js,ts}',
    },
    ...(webkit
      ? [
          {
            // iPad and iPhone browsers are all WebKit: where "not big enough" modals show up
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
            testIgnore: 'built.playwright.{js,ts}',
          },
        ]
      : []),
    {
      // The production build, as `vite preview` serves it: the service worker with its
      // precache, which the dev server does not have
      name: 'built',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${BUILT_PORT}` },
      testMatch: 'built.playwright.{js,ts}',
    },
  ],

  webServer: [
    {
      command: 'npm run dev',
      env: { CHORDLESS_PORT: String(DEV_PORT) },
      url: `http://localhost:${DEV_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    ...(needsBuilt
      ? [
          {
            command: `npm run build && npm run preview -- --port ${BUILT_PORT} --strictPort`,
            url: `http://localhost:${BUILT_PORT}`,
            reuseExistingServer: !process.env.CI,
            timeout: 120 * 1000,
          },
        ]
      : []),
  ],
})
