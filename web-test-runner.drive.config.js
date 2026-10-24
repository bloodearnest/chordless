// The real-Drive suite (docs/DRIVE_TESTS.md): `just test-drive`. Not part of `just test`: it needs
// a test Google account's credentials in the environment, takes minutes, and calls Google.
import { esbuildPlugin } from '@web/dev-server-esbuild'
import { playwrightLauncher } from '@web/test-runner-playwright'
import {
  accessTokens,
  CREDENTIAL_VARIABLES,
  credentialsFromEnv,
  settingsFromEnv,
} from './tests/drive/node-side.ts'

const found = credentialsFromEnv(process.env)
if ('missing' in found) {
  throw new Error(
    `The real-Drive suite needs ${found.missing.join(', ')} (see docs/DRIVE_TESTS.md; they go in .drive-test.env). ` +
      `All of: ${Object.values(CREDENTIAL_VARIABLES).join(', ')}.`
  )
}
const token = accessTokens(found.credentials, { cachePath: '.drive-test/token.json' })
const settings = settingsFromEnv(process.env)

const HOUR = 60 * 60 * 1000

export default {
  files: ['tests/drive/*.drive.test.ts'],
  nodeResolve: true,
  plugins: [
    esbuildPlugin({ ts: true, target: 'auto' }),
    {
      // What the tests in the browser ask of this side: a token (a fresh one if it is nearly out),
      // and what the run was asked for
      name: 'drive-suite',
      executeCommand({ command }) {
        if (command === 'drive-token') return token()
        if (command === 'drive-settings') return settings
        return undefined
      },
    },
  ],
  browsers: [playwrightLauncher({ product: 'chromium' })],
  hostname: '127.0.0.1',
  // (not the unit suite's port, so the two can run together)
  port: 9011,
  // One test at a time: they share one Google account and its rate limits
  concurrency: 1,
  testsStartTimeout: HOUR,
  testsFinishTimeout: 4 * HOUR,
  testFramework: { config: { ui: 'bdd', timeout: HOUR } },
}
