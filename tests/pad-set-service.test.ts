import { expect } from '@open-wc/testing'
import { ensurePadSetFolder, uploadPadFile } from '../src/js/drive-api.ts'
import { PadAudioController } from '../src/js/pad-audio-controller.ts'
import { PAD_FILE_KEYS } from '../src/js/pad-keys.ts'
import {
  ensurePadKeyCached,
  getActivePadSet,
  getPadCacheUrl,
  isPadKeyCached,
  listPadSets,
  type PadSet,
  PadSetChangedEvent,
  preloadPadKeys,
  selectPadSet,
} from '../src/js/pad-set-service.ts'
import { makePadSet } from './builders.ts'
import { installFakeDrive } from './fake-drive.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const PAD_CACHE_NAME = 'padsets-cache-v1'

/** What a pad's audio is in these tests: a few bytes that say which key it is */
const audioOf = (key: string) =>
  new Uint8Array([...new TextEncoder().encode(`audio:${key}`), 0, 255])

describe('pad sets in Drive', () => {
  let drive: ReturnType<typeof installFakeDrive>
  let serial = 0

  beforeEach(() => {
    drive = installFakeDrive()
  })

  afterEach(async () => {
    drive.uninstall()
    await caches.delete(PAD_CACHE_NAME)
    localStorage.removeItem('padset-cache-state')
    localStorage.removeItem('padset-selection')
    expect(
      drive.errors.map((e: Error) => e.message),
      'FakeDrive errors'
    ).to.deep.equal([])
  })

  /**
   * A pad set folder in Drive, as the app makes it: a file for each key. The set is given its own
   * modifiedTime, because what the service remembers of a set is kept for as long as that matches
   */
  async function makeDrivePadSet({ without = [] as string[] } = {}): Promise<PadSet> {
    const folderId = await ensurePadSetFolder(`Test pads ${++serial}`)
    for (const key of PAD_FILE_KEYS) {
      if (without.includes(key)) continue
      await uploadPadFile(folderId, key, new Blob([audioOf(key)], { type: 'audio/mpeg' }))
    }
    return makePadSet({
      id: folderId,
      name: `Test pads ${serial}`,
      modifiedTime: `2026-10-14T12:00:${String(serial).padStart(2, '0')}.000Z`,
    })
  }

  const downloads = () => drive.requests.filter((r: any) => r.params?.get('alt') === 'media')

  async function cachedBytes(padSet: PadSet, key: string) {
    const cache = await caches.open(PAD_CACHE_NAME)
    const response = await cache.match(getPadCacheUrl(padSet.id, key))
    return response ? new Uint8Array(await response.arrayBuffer()) : null
  }

  describe('the list of sets', () => {
    it('is the built-in set, then each pad set folder in Drive', async () => {
      const padSet = await makeDrivePadSet()
      const sets = await listPadSets(true)
      expect(sets.map(s => [s.type, s.name])).to.deep.equal([
        ['builtin', 'Built-in Pads'],
        ['drive', padSet.name],
      ])
      expect(sets[1].id).to.equal(padSet.id)
    })

    it('is just the built-in set when Drive cannot be listed', async () => {
      await makeDrivePadSet()
      drive.failRequests({ method: 'GET', path: /\/files\?q=/, times: 10 })
      const sets = await listPadSets(true)
      expect(sets.map(s => s.type)).to.deep.equal(['builtin'])
    })
  })

  describe('choosing a set', () => {
    it('is remembered, and announced', async () => {
      const padSet = await makeDrivePadSet()
      await listPadSets(true)
      const announced: PadSet[] = []
      const listener = (event: Event) => announced.push((event as PadSetChangedEvent).padSet)
      window.addEventListener(PadSetChangedEvent.type, listener)
      try {
        await selectPadSet(padSet.id)
      } finally {
        window.removeEventListener(PadSetChangedEvent.type, listener)
      }
      expect(getActivePadSet().id).to.equal(padSet.id)
      expect(announced.map(s => s.id)).to.deep.equal([padSet.id])
    })

    it('falls back to the built-in set for one that is gone', async () => {
      await listPadSets(true)
      const chosen = await selectPadSet('no-such-folder')
      expect(chosen.type).to.equal('builtin')
      expect(getActivePadSet().type).to.equal('builtin')
    })

    it('refuses a Drive set that is missing a key, and keeps the old choice', async () => {
      const padSet = await makeDrivePadSet({ without: ['F#'] })
      await listPadSets(true)
      let error: Error | null = null
      await selectPadSet(padSet.id).catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.include('missing files for: F#')
      expect(getActivePadSet().type).to.equal('builtin')
    })
  })

  describe('keeping a pad for offline', () => {
    it('downloads a key from Drive once, and keeps it', async () => {
      const padSet = await makeDrivePadSet()
      expect(await isPadKeyCached(padSet, 'D')).to.equal(false)

      await ensurePadKeyCached(padSet, 'D')

      expect(downloads()).to.have.length(1)
      expect(await isPadKeyCached(padSet, 'D')).to.equal(true)
      expect(await cachedBytes(padSet, 'D')).to.deep.equal(audioOf('D'))
      expect(await isPadKeyCached(padSet, 'E')).to.equal(false)

      await ensurePadKeyCached(padSet, 'D')
      expect(downloads(), 'asked Drive again for a pad it has').to.have.length(1)
    })

    it('finds a key by its flat name, as the pad file of the sharp', async () => {
      const padSet = await makeDrivePadSet()
      await ensurePadKeyCached(padSet, 'Bb')
      expect(await cachedBytes(padSet, 'A#')).to.deep.equal(audioOf('A#'))
    })

    it('shares one download between asks that overlap', async () => {
      const padSet = await makeDrivePadSet()
      await Promise.all([
        ensurePadKeyCached(padSet, 'G'),
        ensurePadKeyCached(padSet, 'G'),
        ensurePadKeyCached(padSet, 'G'),
      ])
      expect(downloads()).to.have.length(1)
    })

    it('keeps what it knows of a set, so the files are listed once', async () => {
      const padSet = await makeDrivePadSet()
      await ensurePadKeyCached(padSet, 'A')
      const listings = () =>
        drive.requests.filter(
          (r: any) =>
            r.path === '/drive/v3/files' &&
            /in parents and trashed=false/.test(r.params?.get('q') ?? '')
        ).length
      const after = listings()
      await ensurePadKeyCached(padSet, 'B')
      expect(listings()).to.equal(after)
    })

    it('fails, and keeps nothing, when Drive cannot send the file', async () => {
      const padSet = await makeDrivePadSet()
      drive.failRequests({ method: 'GET', path: /alt=media/, times: 1 })
      let failed = false
      await ensurePadKeyCached(padSet, 'C').catch(() => {
        failed = true
      })
      expect(failed).to.equal(true)
      expect(await isPadKeyCached(padSet, 'C')).to.equal(false)
      // And the next ask tries again
      await ensurePadKeyCached(padSet, 'C')
      expect(await isPadKeyCached(padSet, 'C')).to.equal(true)
    })

    it('fails for a set that is missing a key', async () => {
      const padSet = await makeDrivePadSet({ without: ['C#'] })
      let error: Error | null = null
      await ensurePadKeyCached(padSet, 'C').catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.include('missing files for: C#')
    })

    it('refuses a key that is not one', async () => {
      const padSet = await makeDrivePadSet()
      let failed = false
      await ensurePadKeyCached(padSet, 'xyz').catch(() => {
        failed = true
      })
      expect(failed).to.equal(true)
    })

    it('has nothing to keep for the built-in set, which is part of the app', async () => {
      const builtin = makePadSet({ id: 'builtin', type: 'builtin' })
      await ensurePadKeyCached(builtin, 'C')
      expect(drive.requests).to.have.length(0)
      expect(await isPadKeyCached(builtin, 'C')).to.equal(false)
    })
  })

  describe('fetching ahead', () => {
    it('does nothing for the built-in set', () => {
      expect(preloadPadKeys(['C', 'D'], makePadSet({ id: 'builtin', type: 'builtin' }))).to.equal(0)
    })
  })

  describe('the pad for a key, to the controller', () => {
    // The controller only needs a context to be made: this resolves URLs and does not play
    const controller = () => new PadAudioController({} as AudioContext)

    it('is the cached copy of a Drive pad, fetched first if need be', async () => {
      const padSet = await makeDrivePadSet()
      const pads = controller()
      expect(await pads._resolvePadUrl('E', padSet)).to.equal(getPadCacheUrl(padSet.id, 'E'))
      expect(await isPadKeyCached(padSet, 'E')).to.equal(true)
      expect(pads.isLoading).to.equal(false)
      // From the cache now: no second download
      expect(await pads._resolvePadUrl('E', padSet)).to.equal(getPadCacheUrl(padSet.id, 'E'))
      expect(downloads()).to.have.length(1)
    })

    it('is nothing, and not stuck loading, when the pad cannot be fetched', async () => {
      const padSet = await makeDrivePadSet({ without: ['A'] })
      const pads = controller()
      const error = console.error
      console.error = () => {}
      try {
        expect(await pads._resolvePadUrl('E', padSet)).to.equal(null)
      } finally {
        console.error = error
      }
      expect(pads.isLoading).to.equal(false)
    })

    it('is the built-in file for the built-in set', async () => {
      const url = await controller()._resolvePadUrl(
        'Bb',
        makePadSet({ id: 'builtin', type: 'builtin' })
      )
      expect(url).to.include('/pads/A%23')
      expect(drive.requests).to.have.length(0)
    })
  })
})
