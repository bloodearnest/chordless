import { createDriveApi } from '../../src/js/drive-client.ts'
import { type Mode, runHistory } from '../sync-history.ts'
import { driveSettings, driveToken } from './commands.ts'
import { makeRealWorld } from './real-world.ts'

const { describe, it, before } = window

/**
 * Random histories of several devices syncing through a real Google Drive folder
 * (docs/DRIVE_TESTS.md). The same engine and promises as tests/drive-sync-random.test.ts, which
 * runs them against an in-memory fake; here Drive's own behaviour (listings that lag, rate limits,
 * its feed of changes, real checksums) is what is being tested.
 *
 * Each history has a folder of its own, which is put in the bin when it passes. A failing history
 * leaves its folder, named in the failure, so its files can be looked at; the next run puts away
 * the folders of earlier runs that are over a day old.
 *
 * A failure names its mode and seed. DRIVE_MODES=<mode> DRIVE_SEEDS=<seed> just test-drive makes
 * the same random choices again; Drive does not repeat itself, so the same history may not fail
 * the same way twice (the in-memory fake can be asked for the same seed to see whether it fails
 * there too: SEEDS in tests/random-histories.ts).
 */

const PREFIX = 'chordless-drive-test'
const DAY = 24 * 60 * 60 * 1000

const settings = await driveSettings()

describe('Drive sync against a real Drive: random histories', () => {
  before(async function (this: { timeout(ms: number): void }) {
    this.timeout(5 * 60 * 1000)
    // Put away the folders earlier failed runs left
    const api = createDriveApi({ getAccessToken: driveToken })
    const old = await api.listDriveFiles(
      `mimeType = 'application/vnd.google-apps.folder' and name contains '${PREFIX}' and trashed = false`
    )
    for (const folder of old) {
      const created = Date.parse(folder.createdTime ?? '')
      if (folder.name?.startsWith(PREFIX) && created < Date.now() - DAY) {
        await api.trashFile(folder.id)
      }
    }
  })

  for (const mode of settings.modes) {
    for (const seed of settings.seeds) {
      it(`keeps devices and Drive consistent (${mode}, seed ${seed})`, async function (this: {
        timeout(ms: number): void
      }) {
        this.timeout(60 * 60 * 1000)
        const spaceName = `${PREFIX} ${new Date().toISOString().slice(0, 16)} ${mode} ${seed} ${crypto.randomUUID().slice(0, 6)}`
        const world = makeRealWorld({ getAccessToken: driveToken, spaceName, settleMs: 2500 })
        const started = Date.now()
        let passed = false
        try {
          await runHistory(world, seed, mode as Mode, {
            devices: settings.devices,
            steps: settings.steps,
            // (each check reads every setlist file)
            checkEvery: 5,
            settleRounds: 4,
          })
          passed = true
        } catch (error) {
          ;(error as Error).message +=
            `\n  (Drive folder kept: "${spaceName}", ${mode} seed ${seed})`
          throw error
        } finally {
          const seconds = Math.round((Date.now() - started) / 1000)
          console.log(
            `${mode} seed ${seed}: ${passed ? 'passed' : 'FAILED'} in ${seconds}s, ${world.counts.requests} requests, ${world.counts.injected} made to fail`
          )
          if (passed) await world.dispose()
          else await world.close()
        }
      })
    }
  }
})
