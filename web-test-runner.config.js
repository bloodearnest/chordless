import { readFileSync } from 'node:fs'
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

export default {
  // Every test file except the node ones (*.node.test.js, run by just test-node)
  files: ['tests/*.test.{js,ts}', '!tests/*.node.test.{js,ts}'],
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
