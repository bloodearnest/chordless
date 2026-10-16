// Takes the pictures the Help pages show (`just help-images`, which `just test` runs first): see
// tests/help-images.shots.ts. A config of its own, as it writes files rather than tests the app.
import { defineConfig, devices } from '@playwright/test'

const PORT = 8793

export default defineConfig({
  testDir: './tests',
  testMatch: 'help-images.shots.ts',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-GB',
    // Twice the pixels, shown at half the size: sharp on a high-density screen
    deviceScaleFactor: 2,
    viewport: { width: 900, height: 1000 },
  },
  projects: [
    {
      name: 'light',
      use: { ...devices['Desktop Chrome'], colorScheme: 'light', deviceScaleFactor: 2 },
    },
    {
      name: 'dark',
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark', deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: 'npm run dev',
    env: { CHORDLESS_PORT: String(PORT) },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
