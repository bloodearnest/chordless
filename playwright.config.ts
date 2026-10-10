import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '*.playwright.{js,ts}',

  timeout: 30 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:8787',
    // Dates follow the browser's locale; fix it so expectations are stable
    locale: 'en-GB',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: 'built.playwright.{js,ts}',
    },
    {
      // The production build, as `vite preview` serves it: the service worker with its
      // precache, which the dev server does not have
      name: 'built',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:8788' },
      testMatch: 'built.playwright.{js,ts}',
    },
  ],

  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:8787',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    {
      command: 'npm run build && npm run preview -- --port 8788 --strictPort',
      url: 'http://localhost:8788',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  ],
})
