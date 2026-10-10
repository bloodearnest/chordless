import { playwrightLauncher } from '@web/test-runner-playwright'

export default {
  // Every test file except the node ones (*.node.test.js, run by just test-node)
  files: ['tests/*.test.js', '!tests/*.node.test.js'],
  nodeResolve: true,
  // Used by just coverage (--coverage): the app's own code, not its dependencies
  coverageConfig: {
    include: ['src/**/*.js'],
    exclude: ['node_modules/**'],
    reportDir: 'coverage',
    reporters: ['html', 'text-summary'],
  },
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
