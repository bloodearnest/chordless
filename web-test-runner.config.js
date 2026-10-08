import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files: [
    'tests/chord-utils.test.js',
    'tests/date-utils.test.js',
    'tests/drive-metadata.test.js',
    'tests/db.test.js',
    'tests/db-usage.test.js',
    'tests/drive-sync-conflicts.test.js',
    'tests/app-modal.test.js',
    'tests/drive-sync.test.js',
    'tests/fake-drive.test.js',
    'tests/keyboard.test.js',
    'tests/library-song.test.js',
    'tests/lyrics-normalizer.test.js',
    'tests/metronome-controller.test.js',
    'tests/nav-menu.test.js',
    'tests/pad-audio-controller.test.js',
    'tests/people.test.js',
    'tests/setlist-details-form.test.js',
    'tests/setlist-song.test.js',
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
