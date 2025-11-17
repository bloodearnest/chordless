import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files: [
    'tests/chord-utils.test.js',
    'tests/db.test.js',
    'tests/db-usage.test.js',
    'tests/lyrics-normalizer.test.js',
    'tests/metronome-controller.test.js',
    'tests/pad-audio-controller.test.js',
    'tests/sync-reconciler.test.js',
    'tests/transpose.legacy.test.js',
  ],
  nodeResolve: true,
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
};
