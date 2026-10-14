import { esbuildPlugin } from '@web/dev-server-esbuild'
import { defaultReporter } from '@web/test-runner'
import { playwrightLauncher } from '@web/test-runner-playwright'
import { statsReporter } from './scripts/wtr-stats-reporter.js'

export default {
  // Every test file except the node ones (*.node.test.js, run by just test-node)
  files: ['tests/*.test.{js,ts}', '!tests/*.node.test.{js,ts}'],
  nodeResolve: true,
  // Types are erased, nothing else: the browser gets the same code it would from Vite
  plugins: [esbuildPlugin({ ts: true, target: 'auto' })],
  // Used by just coverage (--coverage): the app's own code, not its dependencies
  coverageConfig: {
    include: ['src/**/*.{js,ts}'],
    exclude: ['node_modules/**'],
    reportDir: 'coverage',
    // json-summary is read by `just stats`
    reporters: ['html', 'text-summary', 'json-summary'],
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
