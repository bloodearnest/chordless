import { expect } from '@open-wc/testing'
import { PadAudioController } from '../src/js/pad-audio-controller.ts'
import { PAD_FILE_KEYS } from '../src/js/pad-keys.ts'
import {
  derivePadSetName,
  ensurePadKeyCached,
  getActivePadSet,
  getPadCacheUrl,
  isPadKeyCached,
  listPadSets,
  type PadSet,
  PadSetChangedEvent,
  PadSetListUpdatedEvent,
  preloadPadKey,
  preloadPadKeys,
  preloadPadKeysForSongs,
  selectPadSet,
  setPadStorage,
  uploadPadSet,
} from '../src/js/pad-set-service.ts'
import { makePadSet } from './builders.ts'
import { MemoryStorage } from './memory-storage.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import { buildZip, type ZipEntry } from './zip.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const PAD_CACHE_NAME = 'padsets-cache-v1'

/** What a pad's audio is in these tests: a few bytes that say which key it is */
const audioOf = (key: string) =>
  new Uint8Array([...new TextEncoder().encode(`audio:${key}`), 0, 255])

describe('pad sets', () => {
  let storage: MemoryStorage
  let serial = 0

  beforeEach(() => {
    storage = new MemoryStorage()
    setPadStorage(storage.pads)
  })

  afterEach(async () => {
    setPadStorage(null)
    await caches.delete(PAD_CACHE_NAME)
    localStorage.removeItem('padset-cache-state')
    localStorage.removeItem('padset-selection')
  })

  /**
   * A pad set in the storage, as the app makes it: a file for each key. The set is given its own
   * modifiedTime, because what the service remembers of a set is kept for as long as that matches
   */
  async function makeDrivePadSet({ without = [] as string[] } = {}): Promise<PadSet> {
    const folderId = await storage.pads.ensureSet(`Test pads ${++serial}`)
    for (const key of PAD_FILE_KEYS) {
      if (without.includes(key)) continue
      await storage.pads.addFile(folderId, key, new Blob([audioOf(key)], { type: 'audio/mpeg' }))
    }
    return makePadSet({
      id: folderId,
      name: `Test pads ${serial}`,
      modifiedTime: `2026-10-14T12:00:${String(serial).padStart(2, '0')}.000Z`,
    })
  }

  const downloads = () => storage.calls.filter(call => call.op === 'readPadFile')
  const listings = (op: 'listPadSets' | 'listPadFiles') =>
    storage.calls.filter(call => call.op === op).length

  async function cachedBytes(padSet: PadSet, key: string) {
    const cache = await caches.open(PAD_CACHE_NAME)
    const response = await cache.match(getPadCacheUrl(padSet.id, key))
    return response ? new Uint8Array(await response.arrayBuffer()) : null
  }

  describe('the list of sets', () => {
    it('is each pad set in the storage, and nothing else: the app has none', async () => {
      const padSet = await makeDrivePadSet()
      const sets = await listPadSets(true)
      expect(sets.map(s => [s.id, s.name])).to.deep.equal([[padSet.id, padSet.name]])
    })

    it('is empty when the storage cannot be listed', async () => {
      await makeDrivePadSet()
      storage.fail('listPadSets', { times: 10 })
      expect(await listPadSets(true)).to.deep.equal([])
    })
  })

  describe('choosing a set', () => {
    it('is remembered, and announced', async () => {
      const padSet = await makeDrivePadSet()
      await listPadSets(true)
      const announced: (PadSet | null)[] = []
      const listener = (event: Event) => announced.push((event as PadSetChangedEvent).padSet)
      window.addEventListener(PadSetChangedEvent.type, listener)
      try {
        await selectPadSet(padSet.id)
      } finally {
        window.removeEventListener(PadSetChangedEvent.type, listener)
      }
      expect(getActivePadSet()?.id).to.equal(padSet.id)
      expect(announced.map(s => s?.id)).to.deep.equal([padSet.id])
    })

    it('refuses one that is gone, and keeps the old choice', async () => {
      await listPadSets(true)
      let error: Error | null = null
      await selectPadSet('no-such-folder').catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.include('no longer in Google Drive')
      expect(getActivePadSet()).to.equal(null)
    })

    it('refuses a Drive set that is missing a key, and keeps the old choice', async () => {
      const padSet = await makeDrivePadSet({ without: ['F#'] })
      await listPadSets(true)
      let error: Error | null = null
      await selectPadSet(padSet.id).catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.include('missing files for: F#')
      expect(getActivePadSet()).to.equal(null)
    })
  })

  describe('keeping a pad for offline', () => {
    it('downloads a key once, and keeps it', async () => {
      const padSet = await makeDrivePadSet()
      expect(await isPadKeyCached(padSet, 'D')).to.equal(false)

      await ensurePadKeyCached(padSet, 'D')

      expect(downloads()).to.have.length(1)
      expect(await isPadKeyCached(padSet, 'D')).to.equal(true)
      expect(await cachedBytes(padSet, 'D')).to.deep.equal(audioOf('D'))
      expect(await isPadKeyCached(padSet, 'E')).to.equal(false)

      await ensurePadKeyCached(padSet, 'D')
      expect(downloads(), 'asked again for a pad it has').to.have.length(1)
    })

    it('finds a key by its flat name, as the pad file of the sharp', async () => {
      const padSet = await makeDrivePadSet()
      await ensurePadKeyCached(padSet, 'Bb')
      expect(await cachedBytes(padSet, 'A#')).to.deep.equal(audioOf('A#'))
    })

    it('ignores a file in the folder that is not for a key', async () => {
      const padSet = await makeDrivePadSet()
      storage.padFiles.set('notes', {
        ref: 'notes',
        set: padSet.id,
        name: 'notes.txt',
        padKey: null,
        type: 'text/plain',
        bytes: new TextEncoder().encode('not a pad'),
        trashed: false,
      })
      await ensurePadKeyCached(padSet, 'C')
      expect(await isPadKeyCached(padSet, 'C')).to.equal(true)
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
      const after = listings('listPadFiles')
      await ensurePadKeyCached(padSet, 'B')
      expect(listings('listPadFiles')).to.equal(after)
    })

    it('fails, and keeps nothing, when the storage cannot send the file', async () => {
      const padSet = await makeDrivePadSet()
      storage.fail('readPadFile')
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

    it('has nothing to keep for no key', async () => {
      const padSet = await makeDrivePadSet()
      const before = storage.calls.length
      await ensurePadKeyCached(padSet, '')
      expect(storage.calls).to.have.length(before)
    })

    it('refuses a key that is not one', async () => {
      const padSet = await makeDrivePadSet()
      let failed = false
      await ensurePadKeyCached(padSet, 'xyz').catch(() => {
        failed = true
      })
      expect(failed).to.equal(true)
    })

    it('has nothing to keep with no pad set', async () => {
      expect(await isPadKeyCached(null, 'C')).to.equal(false)
      expect(storage.calls).to.have.length(0)
    })
  })

  describe('fetching ahead', () => {
    it('does nothing with no pad set', () => {
      expect(preloadPadKeys(['C', 'D'], null)).to.equal(0)
    })
  })

  describe('the pad for a key, to the controller', () => {
    // The controller only needs a context to be made: this resolves URLs and does not play
    const controller = () => new PadAudioController({} as AudioContext)

    it('is the cached copy of a pad, fetched first if need be', async () => {
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

    it('is nothing with no pad set: the app ships none', async () => {
      expect(await controller()._resolvePadUrl('Bb', null)).to.equal(null)
      expect(storage.calls).to.have.length(0)
    })
  })

  describe('uploading a set from a zip file', () => {
    const allKeys = PAD_FILE_KEYS.map(key => key as string)
    const mp3 = (name: string) => ({ name, data: audioOf(name) })
    /** An entry for each key, in a folder like the zips pad makers give */
    const entriesFor = (keys: string[], extra: Partial<ZipEntry> = {}) =>
      keys.map(key => ({ ...mp3(`Pads/Warm Pad - ${key}.mp3`), ...extra }))

    /** The files in a pad set, by name */
    const filesIn = (setRef: string) =>
      Object.fromEntries(
        [...storage.padFiles.values()]
          .filter(file => file.set === setRef && !file.trashed)
          .map(file => [file.name, file.bytes])
      )

    async function failureOf(promise: Promise<unknown>) {
      try {
        await promise
      } catch (error) {
        return (error as Error).message
      }
      return null
    }

    it('puts a file for each key in the storage, and returns the set', async () => {
      const zip = await buildZip(entriesFor(allKeys), 'Warm_Pad-Set.zip')

      const padSet = await uploadPadSet(zip)

      expect(padSet).to.deep.equal({ id: padSet.id, name: 'Warm Pad Set' })
      // the first set uploaded is the one in use: there is no other
      expect(getActivePadSet()?.id).to.equal(padSet.id)
      const files = filesIn(padSet.id)
      expect(Object.keys(files).sort()).to.deep.equal(allKeys.map(key => `${key}.mp3`).sort())
      for (const key of allKeys) {
        expect(files[`${key}.mp3`], key).to.deep.equal(audioOf(`Pads/Warm Pad - ${key}.mp3`))
      }
    })

    it('keeps the pads of a set that the storage gave no modified time for, as of when they were listed', async () => {
      // (uploading forgets anything kept under the set's id, which a fake Drive repeats; and a
      // set already in use means the upload does not choose this one, which would list it)
      localStorage.setItem('padset-selection', JSON.stringify({ id: 'other', name: 'Other' }))
      const padSet = await uploadPadSet(await buildZip(entriesFor(allKeys), 'Fresh.zip'))
      await caches.delete(PAD_CACHE_NAME)

      await ensurePadKeyCached({ id: padSet.id, name: padSet.name }, 'C')

      expect(await isPadKeyCached(padSet, 'C')).to.equal(true)
      const kept = JSON.parse(localStorage.getItem('padset-cache-state') ?? '{}')[padSet.id]
      expect(Date.now() - Date.parse(kept.modifiedTime)).to.be.below(60_000)
    })

    it('names a set by its file: without the extension, with spaces for dashes and underscores', () => {
      expect(derivePadSetName('Warm_Pad-Set.zip')).to.equal('Warm Pad Set')
      expect(derivePadSetName('Ambient Pads (v2).zip')).to.equal('Ambient Pads v2')
      expect(derivePadSetName('---.zip')).to.equal('New Pad Set')
      expect(derivePadSetName()).to.equal('New Pad Set')
    })

    it('is listed once for two askers at the same time, after an upload cleared the list', async () => {
      // (a set already in use, so the upload does not choose its set, and list the sets again)
      localStorage.setItem('padset-selection', JSON.stringify({ id: 'other', name: 'Other' }))
      await uploadPadSet(await buildZip(entriesFor(allKeys), 'Listed.zip'))
      const before = listings('listPadSets')

      const [first, second] = await Promise.all([listPadSets(), listPadSets()])
      const asked = listings('listPadSets') - before

      expect(second).to.equal(first)
      expect(await listPadSets(), 'and then it is kept').to.equal(first)
      expect(listings('listPadSets') - before).to.equal(asked)
      // (the storage is asked as often as for a single list)
      await listPadSets(true)
      expect(listings('listPadSets') - before - asked).to.equal(asked)
    })

    it('reads files the zip tool deflated', async () => {
      const zip = await buildZip(entriesFor(allKeys, { method: 'deflate' }))

      const padSet = await uploadPadSet(zip, 'Deflated')

      expect(filesIn(padSet.id)['G#.mp3']).to.deep.equal(audioOf('Pads/Warm Pad - G#.mp3'))
    })

    it('is named by the name it is given, else by its file', async () => {
      const zip = await buildZip(entriesFor(allKeys), 'from-file.zip')

      expect((await uploadPadSet(zip, '  Chosen name ')).name).to.equal('Chosen name')
      expect((await uploadPadSet(zip)).name).to.equal('from file')
    })

    it('takes flats as the sharps the keys are named by', async () => {
      const sharps = ['A#', 'C#', 'D#', 'F#', 'G#']
      const flats = ['Bb', 'Db', 'Eb', 'Gb', 'Ab']
      const names = allKeys.map(key => (sharps.includes(key) ? flats[sharps.indexOf(key)] : key))
      const zip = await buildZip(names.map(name => mp3(`${name}.mp3`)))

      const padSet = await uploadPadSet(zip, 'Flats')

      expect(Object.keys(filesIn(padSet.id)).sort()).to.deep.equal(
        allKeys.map(key => `${key}.mp3`).sort()
      )
      expect(filesIn(padSet.id)['A#.mp3']).to.deep.equal(audioOf('Bb.mp3'))
    })

    it('ignores folders, other kinds of file, and files that are not a key', async () => {
      const zip = await buildZip([
        { name: 'Pads/' },
        { name: 'Pads/readme.txt', data: new Uint8Array([1]) },
        mp3('Pads/Intro.mp3'),
        ...entriesFor(allKeys),
      ])

      const padSet = await uploadPadSet(zip, 'Mixed')

      expect(Object.keys(filesIn(padSet.id))).to.have.length(12)
    })

    it('takes the file nearest the top of the zip when two are for a key', async () => {
      const zip = await buildZip([
        mp3('Alternate takes/Old/C.mp3'),
        mp3('C.mp3'),
        ...entriesFor(allKeys.filter(key => key !== 'C')),
      ])

      const padSet = await uploadPadSet(zip, 'Doubled')

      expect(filesIn(padSet.id)['C.mp3']).to.deep.equal(audioOf('C.mp3'))
    })

    it('tells the page the list of sets changed, and the list is read again', async () => {
      let told = 0
      const listener = () => told++
      window.addEventListener(PadSetListUpdatedEvent.type, listener)
      try {
        await listPadSets(true)
        const padSet = await uploadPadSet(await buildZip(entriesFor(allKeys)), 'Listed')
        expect(told).to.equal(1)
        expect((await listPadSets()).map(set => set.id)).to.include(padSet.id)
      } finally {
        window.removeEventListener(PadSetListUpdatedEvent.type, listener)
      }
    })

    it('replaces what was in the folder, and what was kept of it for offline', async () => {
      const zip = await buildZip(entriesFor(allKeys))
      const first = await uploadPadSet(zip, 'Same name')
      await ensurePadKeyCached(makePadSet({ id: first.id, name: first.name }), 'C')
      expect(await cachedBytes(first as PadSet, 'C')).to.not.equal(null)

      const again = await uploadPadSet(
        await buildZip(entriesFor(allKeys).map(entry => ({ ...entry, data: audioOf('new') }))),
        'Same name'
      )

      expect(again.id).to.equal(first.id)
      const files = filesIn(first.id)
      const inSet = [...storage.padFiles.values()].filter(file => file.set === first.id)
      expect(inSet.filter(file => !file.trashed)).to.have.length(12)
      // the old ones are in the trash, not gone
      expect(inSet.filter(file => file.trashed)).to.have.length(12)
      expect(files['C.mp3']).to.deep.equal(audioOf('new'))
      expect(await cachedBytes(first as PadSet, 'C')).to.equal(null)
    })

    describe('refuses', () => {
      /** Nothing is made for a zip that is refused */
      const nothingMade = () => expect(storage.padSets.size).to.equal(0)

      it('no file', async () => {
        expect(await failureOf(uploadPadSet(null))).to.equal('Please select a pad set ZIP file.')
        nothingMade()
      })

      it('a name of only spaces', async () => {
        const zip = await buildZip(entriesFor(allKeys), 'pads.zip')
        expect(await failureOf(uploadPadSet(zip, '   '))).to.equal('Please provide a pad set name.')
        nothingMade()
      })

      it('a zip missing keys, naming them', async () => {
        const zip = await buildZip(entriesFor(allKeys.filter(key => key !== 'D' && key !== 'F#')))
        expect(await failureOf(uploadPadSet(zip, 'Short'))).to.equal(
          'Missing keys in pad set: D, F#'
        )
        nothingMade()
      })

      it('a file that is not a zip', async () => {
        const notZip = new File([new Uint8Array(100)], 'pads.zip')
        expect(await failureOf(uploadPadSet(notZip, 'Bad'))).to.equal(
          'Invalid ZIP file (EOCD not found)'
        )
        nothingMade()
      })

      it('an encrypted zip', async () => {
        const zip = await buildZip(entriesFor(allKeys, { flags: 1 }))
        expect(await failureOf(uploadPadSet(zip, 'Secret'))).to.equal(
          'Encrypted ZIP archives are not supported.'
        )
        nothingMade()
      })

      it('a zip using a compression it cannot read', async () => {
        const zip = await buildZip(entriesFor(allKeys, { rawMethod: 12 }))
        expect(await failureOf(uploadPadSet(zip, 'Bzip'))).to.equal(
          'Unsupported ZIP compression method: 12'
        )
        nothingMade()
      })
    })
  })

  describe('when what it kept is damaged, or the browser lacks a cache', () => {
    it('is no set when the remembered choice is not readable', () => {
      localStorage.setItem('padset-selection', '{not json')
      expect(getActivePadSet()).to.equal(null)
    })

    it('lists the set again when what it kept of the sets is not readable', async () => {
      const padSet = await makeDrivePadSet()
      localStorage.setItem('padset-cache-state', '{not json')
      await ensurePadKeyCached(padSet, 'C')
      expect(await isPadKeyCached(padSet, 'C')).to.equal(true)
    })

    it('uses what it kept of a set, without asking the storage again', async () => {
      const made = await makeDrivePadSet()
      const padSet = must((await listPadSets(true)).find(set => set.id === made.id))
      const files = Object.fromEntries(
        PAD_FILE_KEYS.map(key => [key, { fileId: 'unknown', mimeType: 'audio/mpeg' }])
      )
      localStorage.setItem(
        'padset-cache-state',
        JSON.stringify({
          [padSet.id]: { modifiedTime: padSet.modifiedTime, cachedAt: 'then', files },
        })
      )
      const before = listings('listPadFiles')
      await selectPadSet(padSet.id)
      expect(listings('listPadFiles')).to.equal(before)
    })

    it('fails for a key a kept set has no file for', async () => {
      const padSet = await makeDrivePadSet()
      localStorage.setItem(
        'padset-cache-state',
        JSON.stringify({
          [padSet.id]: { modifiedTime: padSet.modifiedTime, cachedAt: 'then', files: {} },
        })
      )
      let message = ''
      try {
        await ensurePadKeyCached(padSet, 'C')
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.equal(`Pad set "${padSet.name}" is missing key: C`)
    })

    describe('with no Cache Storage', () => {
      const real = Object.getOwnPropertyDescriptor(window, 'caches')
      beforeEach(() => {
        Object.defineProperty(window, 'caches', { value: undefined, configurable: true })
      })
      afterEach(() => {
        if (real) Object.defineProperty(window, 'caches', real)
        else delete (window as unknown as { caches?: unknown }).caches
      })

      it('keeps nothing, and says no pad is kept', async () => {
        const padSet = await makeDrivePadSet()
        await ensurePadKeyCached(padSet, 'C')
        expect(await isPadKeyCached(padSet, 'C')).to.equal(false)
        expect(downloads()).to.have.length(0)
      })
    })

    it('says no pad is kept for a key that is not one', async () => {
      const padSet = await makeDrivePadSet()
      expect(await isPadKeyCached(padSet, 'H#')).to.equal(false)
    })
  })

  describe('fetching ahead, when a pad cannot be fetched', () => {
    it('only warns', async () => {
      const padSet = await makeDrivePadSet({ without: ['A'] })
      expect(preloadPadKeys(['C'], padSet)).to.equal(1)
      await new Promise(resolve => setTimeout(resolve, 150))
    })
  })

  describe('refusing a zip that is damaged', () => {
    const allKeys = PAD_FILE_KEYS.map(key => key as string)
    const entries = (extra: Partial<ZipEntry> = {}) =>
      allKeys.map(key => ({ name: `${key}.mp3`, data: audioOf(key), ...extra }))
    const messageOf = async (promise: Promise<unknown>) => {
      try {
        await promise
      } catch (error) {
        return (error as Error).message
      }
      return null
    }
    /** The zip with some of its bytes overwritten, found by what is there now */
    async function corrupted(zip: File, signature: number[]) {
      const bytes = new Uint8Array(await zip.arrayBuffer())
      for (let at = 0; at < bytes.length - 4; at++) {
        if (signature.every((byte, i) => bytes[at + i] === byte)) {
          bytes.fill(0, at, at + 4)
          if (signature[2] === 0x03) break
          at += 4
          break
        }
      }
      return new File([bytes], zip.name)
    }

    it('with no entries it can find, as having no keys', async () => {
      // The central directory is not where it says it is
      const zip = await corrupted(await buildZip(entries()), [0x50, 0x4b, 0x01, 0x02])
      expect(await messageOf(uploadPadSet(zip, 'Broken'))).to.contain('Missing keys in pad set')
    })

    it('with a file whose own header is not there', async () => {
      const zip = await corrupted(await buildZip(entries()), [0x50, 0x4b, 0x03, 0x04])
      expect(await messageOf(uploadPadSet(zip, 'Broken'))).to.equal('Invalid ZIP local header')
    })

    it('with files that are not the deflated data they say', async () => {
      const zip = await buildZip(entries({ data: new Uint8Array(40).fill(255), rawMethod: 8 }))
      expect(await messageOf(uploadPadSet(zip, 'Broken'))).to.equal(
        'Browser does not support deflate decompression for ZIP uploads'
      )
    })
  })

  describe('a set the storage gave no modified time for', () => {
    it('uses what it kept of it, whatever that was', async () => {
      const made = await makeDrivePadSet()
      const padSet = { ...made, modifiedTime: null }
      await ensurePadKeyCached(padSet, 'C')
      const before = listings('listPadFiles')
      await ensurePadKeyCached(padSet, 'D')
      expect(listings('listPadFiles')).to.equal(before)
    })
  })

  describe('fetching ahead for songs', () => {
    it('fetches the pads for the key each song is in, from wherever it says', async () => {
      const padSet = await makeDrivePadSet()
      preloadPadKeysForSongs(
        [{ currentKey: 'C' }, { metadata: { key: 'D' } }, { originalKey: 'E' }, {}],
        padSet
      )
      preloadPadKey('', padSet)
      for (let i = 0; i < 40 && downloads().length < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      expect(downloads()).to.have.length(3)
    })
  })
})
