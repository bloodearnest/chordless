import { globSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { esbuildPlugin } from '@web/dev-server-esbuild'
import { defaultReporter } from '@web/test-runner'
import { playwrightLauncher } from '@web/test-runner-playwright'
import { statsReporter } from './scripts/wtr-stats-reporter.js'

// What Vite gives the page from .env.development (npm run dev), which the unit tests run with too
const devEnv = Object.fromEntries(
  readFileSync('.env.development', 'utf8')
    .split('\n')
    .filter(line => /^VITE_\w+=/.test(line))
    .map(line => line.split(/=(.*)/s).slice(0, 2))
)

// Every test file except the node ones (*.node.test.js, run by just test-node), the slowest first
// (by the last full run, .stats/unit-files.json): files start in this order, and a slow one that
// started last would hold up the end of the run on its own
const lastTimes = (() => {
  try {
    return JSON.parse(readFileSync('.stats/unit-files.json', 'utf8'))
  } catch {
    return {}
  }
})()
const testFiles = globSync('tests/*.test.{js,ts}')
  .filter(file => !/\.node\.test\./.test(file))
  .sort((a, b) => (lastTimes[b] ?? 0) - (lastTimes[a] ?? 0) || a.localeCompare(b))

export default {
  files: testFiles,
  // A page at a time for every two processors the machine lets this have (one a core, where each
  // runs two threads; a CI runner's share), as the Playwright tests beside it (`just test`) have
  concurrency: Math.max(1, Math.floor(availableParallelism() / 2)),
  nodeResolve: true,
  // Types are erased, nothing else: the browser gets the same code it would from Vite
  plugins: [
    esbuildPlugin({
      ts: true,
      target: 'auto',
      define: { 'import.meta.env': JSON.stringify(devEnv) },
    }),
  ],
  // Used by just coverage (--coverage): the app's own code, not its dependencies
  coverageConfig: {
    include: ['src/**/*.{js,ts}'],
    exclude: ['node_modules/**'],
    reportDir: 'coverage',
    // json-summary is read by `just stats`, lcov by scripts/coverage.ts
    reporters: ['html', 'text-summary', 'json-summary', 'lcov'],
  },
  // A full run for `just stats` (STATS=1) also writes its counts to .stats/unit.json
  ...(process.env.STATS && { reporters: [defaultReporter(), statsReporter()] }),
  browsers: [
    playwrightLauncher({
      product: 'chromium',
    }),
  ],
  hostname: '127.0.0.1',
  port: 9010,
  testFramework: {
    config: {
      ui: 'bdd',
    },
  },
}
