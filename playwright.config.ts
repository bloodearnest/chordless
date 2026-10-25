import { availableParallelism } from 'node:os'
import { defineConfig, devices } from '@playwright/test'

// The tests run their own servers, on ports of their own: 8787 is the development server's
// (the origin the browser's data belongs to) and 8788 is `just preview`'s, and a test run
// must never meet either
const DEV_PORT = 8791
const BUILT_PORT = 8792

// The built app is a `vite build` away: skip it when the run names test files, or the chromium
// project, and none of them is the built one (`just test-browser-headless tests/live.playwright.ts`)
const args = process.argv.slice(2)
const files = args.filter(a => /\.playwright\./.test(a))
const projects = args.filter(a => /^--project/.test(a))
const needsBuilt =
  args.includes('--ui') ||
  files.some(a => /built/.test(a)) ||
  projects.some(a => /built$/.test(a)) ||
  (files.length === 0 && (projects.length === 0 || projects.some(a => /built/.test(a))))

// One browser per run: Chromium, unless CHORDLESS_BROWSER says `webkit` (Safari's engine, which
// roughly doubles the run, so it is opt-in: `just test-webkit`, or --project=webkit), `chrome`
// (Google's own build, as installed) or `msedge` (Microsoft's, as installed: Windows' own, CI's
// Windows job). Plain runs, and `just test`, stay on Chromium
// (Workers get no command line, so the choice goes to them in the environment.)
if (args.some(a => /webkit/.test(a))) process.env.CHORDLESS_BROWSER = 'webkit'
const BROWSERS = {
  chromium: devices['Desktop Chrome'],
  // iPad and iPhone browsers are all WebKit: where "not big enough" modals show up
  webkit: devices['Desktop Safari'],
  chrome: { ...devices['Desktop Chrome'], channel: 'chrome' },
  msedge: { ...devices['Desktop Edge'], channel: 'msedge' },
}
const browser = (process.env.CHORDLESS_BROWSER || 'chromium') as keyof typeof BROWSERS
if (!(browser in BROWSERS)) {
  throw new Error(`CHORDLESS_BROWSER=${browser}: one of ${Object.keys(BROWSERS).join(', ')}`)
}
// Chromium's projects keep their first names, `chromium` and `built`
const name = (project: string) =>
  browser === 'chromium' ? project : project === 'built' ? `built-${browser}` : browser

// A server already on its port is used rather than started: always where `just test` started them
// (scripts/test-all.sh), and outside CI, where a fresh machine has none to find
const reuseServers = !process.env.CI || process.env.CHORDLESS_SERVERS_STARTED === '1'

export default defineConfig({
  testDir: './tests',
  testMatch: '*.playwright.{js,ts}',

  timeout: 30 * 1000,
  fullyParallel: true,
  // A worker for every two processors the machine lets this have (one a core, where each core runs
  // two threads; a CI runner's share, in a container): more make each test slower, not the run
  // shorter, as the browsers, the servers and the unit tests beside them (`just test`) need the rest.
  // Two at least: CI's macOS runner has three cores with a thread each, which would make one.
  // CHORDLESS_WORKERS says how many instead (CI's end-to-end jobs, docs/CI.md)
  workers:
    Number(process.env.CHORDLESS_WORKERS) || Math.max(2, Math.floor(availableParallelism() / 2)),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // In CI, failures also annotate the PR's diff, and the HTML report is kept as an artifact
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: `http://localhost:${DEV_PORT}`,
    // Dates follow the browser's locale; fix it so expectations are stable
    locale: 'en-GB',
    // A failure keeps its trace. The page's DOM at each step is most of what a trace costs (a
    // fifth of a whole run's time), so a run of named files has it, to look into a failure, and
    // a whole run keeps the steps, console and network only (with the screenshot below)
    trace:
      files.length > 0
        ? 'retain-on-failure'
        : { mode: 'retain-on-failure', snapshots: false, screenshots: false },
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: name('chromium'),
      use: BROWSERS[browser],
      testIgnore: 'built.playwright.{js,ts}',
    },
    {
      // The production build, as `vite preview` serves it: the service worker with its
      // precache, which the dev server does not have
      name: name('built'),
      use: { ...BROWSERS[browser], baseURL: `http://localhost:${BUILT_PORT}` },
      testMatch: 'built.playwright.{js,ts}',
    },
  ],

  webServer: [
    {
      command: 'npm run dev',
      env: { CHORDLESS_PORT: String(DEV_PORT) },
      url: `http://localhost:${DEV_PORT}`,
      reuseExistingServer: reuseServers,
      timeout: 120 * 1000,
    },
    ...(needsBuilt
      ? [
          {
            command: `npm run build && npm run preview -- --port ${BUILT_PORT} --strictPort`,
            url: `http://localhost:${BUILT_PORT}`,
            reuseExistingServer: reuseServers,
            timeout: 120 * 1000,
          },
        ]
      : []),
  ],
})
