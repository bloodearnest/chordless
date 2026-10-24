import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import {
  megabytes,
  type SpaceExportPanel,
  SpaceImportedEvent,
} from '../src/components/space-export-panel.ts'
import { ChordlessDB, getCurrentDB } from '../src/js/db.ts'
import { PAD_FILE_KEYS } from '../src/js/pad-keys.ts'
import { uploadPadSet } from '../src/js/pad-set-service.ts'
import { addChart, hashText } from '../src/js/song-utils.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  getSpaceById,
  setCurrentSpace,
} from '../src/js/space.ts'
import { createExport } from '../src/js/space-export.ts'
import { makeEntry, makeSetlist } from './builders.ts'
import { installFakeDrive } from './fake-drive.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'
import { buildZip } from './zip.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const ALPHA = '{title: Alpha}\n{key: G}\n[G]Alpha line'
const ADD = { variantLabel: 'Original', importSource: 'test', makeDefault: 'first' } as const
const PAD_CACHE_NAME = 'padsets-cache-v1'

describe('the export panel', () => {
  let before: { id: string | null; name: string }
  let spaceId: string
  let drive: ReturnType<typeof installFakeDrive>
  let realClick: typeof HTMLAnchorElement.prototype.click
  let downloads: { name: string; size: number }[]

  beforeEach(async () => {
    drive = installFakeDrive()
    before = getCurrentSpace()
    const space = await createSpace(`Export ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
    downloads = []
    realClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download) {
        fetch(this.href)
          .then(response => response.blob())
          .then(blob => downloads.push({ name: this.download, size: blob.size }))
      }
    }
  })

  afterEach(async () => {
    HTMLAnchorElement.prototype.click = realClick
    drive.uninstall()
    await caches.delete(PAD_CACHE_NAME)
    localStorage.removeItem('padset-cache-state')
    localStorage.removeItem('padset-selection')
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  /** The panel for the space made for the test (signed in means pad sets are on offer too) */
  async function mount({ signedIn = false }: { signedIn?: boolean } = {}) {
    const space = must(await getSpaceById(spaceId))
    return fixture<SpaceExportPanel>(
      html`<space-export-panel .space=${space} ?signed-in=${signedIn} ?show-pads=${signedIn}></space-export-panel>`
    )
  }

  const text = (el: SpaceExportPanel) => el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''
  const button = (el: SpaceExportPanel, id: string) =>
    must(el.shadowRoot?.querySelector<HTMLButtonElement>(`#${id}`))

  /** A space's export file, from a database made for it */
  async function exportOf(name: string, fill = true) {
    const id = `source-${crypto.randomUUID()}`
    const db = new ChordlessDB(id)
    await db.init()
    try {
      if (fill) {
        const song = await addChart(db, ALPHA, ADD)
        await db.saveSetlist(
          makeSetlist({
            id: 'set-9',
            songs: [makeEntry({ songId: song.id, songUuid: song.uuid, key: 'A' })],
          })
        )
      }
      return new File([await createExport(db, name)], 'export.zip')
    } finally {
      db.db?.close()
      await deleteDatabase(id)
    }
  }

  async function choose(el: SpaceExportPanel, file: File) {
    const input = must(el.shadowRoot?.querySelector<HTMLInputElement>('input[type=file]'))
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('change'))
  }

  it('gives sizes in megabytes, with a decimal only for small ones', () => {
    expect(megabytes(1.5 * 1024 * 1024)).to.equal('1.5 MB')
    expect(megabytes(48.6 * 1024 * 1024)).to.equal('49 MB')
  })

  it('does nothing when asked to import with no export chosen', async () => {
    const el = await mount()
    await el._import()
    expect(text(el)).to.not.contain('Imported')
  })

  it('offers no pad sets when not signed in', async () => {
    const el = await mount()
    expect(el.shadowRoot?.querySelector('#include-pads')).to.equal(null)
    expect(text(el)).to.contain('Export this space')
  })

  it('downloads an export of the current space, named by space and day', async () => {
    const db = await getCurrentDB()
    await addChart(db, ALPHA, ADD)
    const el = await mount()
    button(el, 'export-space').click()
    await waitUntil(() => downloads.length === 1, 'the download')
    expect(downloads[0]?.name).to.match(
      /^chordless-export-Export-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}\.zip$/
    )
    expect(downloads[0]?.size).to.be.greaterThan(100)
    expect(text(el)).to.contain('Exported as chordless-export-')
  })

  it('says why an export could not be made', async () => {
    const db = await getCurrentDB()
    const real = Object.getPrototypeOf(db).getAllSongs
    Object.getPrototypeOf(db).getAllSongs = () => Promise.reject(new Error('disk full'))
    try {
      const el = await mount()
      button(el, 'export-space').click()
      await waitUntil(() => text(el).includes('Exporting failed'), 'the failure')
      expect(text(el)).to.contain('disk full')
    } finally {
      Object.getPrototypeOf(db).getAllSongs = real
    }
  })

  it('imports into this space, and says what was added and what was already there', async () => {
    const file = await exportOf('Elsewhere')
    const el = await mount()
    await choose(el, file)
    await waitUntil(() => text(el).includes('Import this export'), 'the question')
    expect(text(el)).to.contain('Exported from Elsewhere')
    expect(text(el)).to.contain('1 charts, 1 setlists')

    button(el, 'import').click()
    await waitUntil(() => text(el).includes('Imported into Export'), 'the import')
    expect(text(el)).to.contain('1 charts and 1 setlists added')
    const db = await getCurrentDB()
    expect(await db.getAllSongs()).to.have.length(1)
    expect(must(await db.getSetlist('set-9')).songs[0]?.key).to.equal('A')

    // Again: nothing to add
    await choose(el, file)
    await waitUntil(() => text(el).includes('Import this export'), 'the question')
    button(el, 'import').click()
    await waitUntil(() => text(el).includes('0 charts and 0 setlists added'), 'the second import')
    expect(text(el)).to.contain('1 charts and 1 setlists were already there')
  })

  describe('reset from an export', () => {
    const FIXED = '{title: Alpha}\n{key: G}\n[G]Alpha fixed line'

    /** The space holds Alpha as it was; the file is its export with Alpha repaired */
    async function repairedFile() {
      const el = await mount()
      await choose(el, await exportOf('Elsewhere'))
      await waitUntil(() => text(el).includes('Import this export'), 'the question')
      button(el, 'import').click()
      await waitUntil(() => text(el).includes('Imported into Export'), 'the import')
      const db = await getCurrentDB()
      const song = must((await db.getAllSongs())[0])
      const chart = (content: string) =>
        db.saveChordPro({ id: song.chordproFileId, content, contentHash: hashText(content) })
      await chart(FIXED)
      const file = new File([await createExport(db, 'Repaired')], 'repaired.zip')
      await chart(ALPHA)
      return { el, db, song, file }
    }

    it('shows what a reset would change, then replaces the charts that differ and keeps the rest', async () => {
      const { el, db, song, file } = await repairedFile()
      let imported = 0
      el.addEventListener(SpaceImportedEvent.type, () => imported++)
      await choose(el, file)
      await waitUntil(() => text(el).includes('Import this export'), 'the question')

      button(el, 'reset-start').click()
      await waitUntil(() => text(el).includes('to this export'), 'the plan')
      expect(text(el)).to.contain('1 charts and 0 setlists here will be replaced')
      expect(text(el)).to.contain('1 are already the same')
      expect(must(await db.getChordPro(song.chordproFileId)).content, 'not yet').to.equal(ALPHA)

      button(el, 'reset-confirm').click()
      await waitUntil(() => text(el).includes('from the export:'), 'the reset')
      expect(text(el)).to.contain('1 charts and 0 setlists replaced')
      expect(must(await db.getChordPro(song.chordproFileId)).content).to.equal(FIXED)
      expect(must(await db.getSong(song.uuid)).chordproFileId).to.equal(song.chordproFileId)
      expect(imported).to.equal(1)
      expect(text(el)).to.not.contain('to this export')
    })

    it('offers a backup of the space first, and can be cancelled without changing anything', async () => {
      const { el, db, song, file } = await repairedFile()
      await choose(el, file)
      await waitUntil(() => text(el).includes('Import this export'), 'the question')
      button(el, 'reset-start').click()
      await waitUntil(() => text(el).includes('to this export'), 'the plan')

      button(el, 'reset-backup').click()
      await waitUntil(() => downloads.length === 1, 'the backup')

      button(el, 'reset-cancel').click()
      await el.updateComplete
      expect(text(el)).to.not.contain('Reset Export')
      expect(must(await db.getChordPro(song.chordproFileId)).content).to.equal(ALPHA)
    })

    it('does nothing when asked to plan or reset with no export chosen', async () => {
      const el = await mount()
      await el._planReset()
      await el._doReset()
      expect(text(el)).to.not.contain('Reset')
    })

    it('says what it keeps, and which changes made here after the file it would undo', async () => {
      const { el, db, song, file } = await repairedFile()
      // (a chart only here, and Alpha changed here since the file was made)
      await addChart(db, '{title: Gamma}\n[A]Gamma line', ADD)
      await db.saveSong({ ...song, modifiedDate: '2999-01-01T00:00:00.000Z' })
      await choose(el, file)
      await waitUntil(() => text(el).includes('Import this export'), 'the question')

      button(el, 'reset-start').click()
      await waitUntil(() => text(el).includes('to this export'), 'the plan')
      expect(text(el)).to.contain(
        '1 charts and 0 setlists that are here and not in the file are kept'
      )
      expect(text(el)).to.contain('1 changed here after the file was made')
      expect(text(el)).to.contain('replace it: Alpha.')

      button(el, 'reset-confirm').click()
      await waitUntil(() => text(el).includes('from the export:'), 'the reset')
      expect(text(el)).to.contain('1 charts and 0 setlists that are not in the file were kept')
    })

    it('names the first eight of many changes made here, and counts the rest', async () => {
      const { el, file } = await repairedFile()
      await choose(el, file)
      await waitUntil(() => text(el).includes('Import this export'), 'the question')
      const item = (n: number) => ({ id: `s${n}`, label: `Song ${n}`, newerHere: true })
      el._reset = {
        songsReplaced: Array.from({ length: 10 }, (_, n) => item(n)),
        songsAdded: [],
        songsSame: 0,
        songsOnlyHere: 0,
        setlistsReplaced: [],
        setlistsAdded: [],
        setlistsSame: 0,
        setlistsOnlyHere: 0,
      }
      await el.updateComplete
      expect(text(el)).to.contain('10 changed here after the file was made')
      expect(text(el)).to.contain('Song 7, and 2 more.')
    })

    it('says why the space could not be checked, and changes nothing', async () => {
      const { el, file } = await repairedFile()
      await choose(el, file)
      await waitUntil(() => text(el).includes('Import this export'), 'the question')
      const real = ChordlessDB.prototype.getAllSongs
      ChordlessDB.prototype.getAllSongs = async () => {
        throw new Error('database closed')
      }
      try {
        button(el, 'reset-start').click()
        await waitUntil(
          () => text(el).includes('Could not check the space: database closed'),
          'the failure'
        )
      } finally {
        ChordlessDB.prototype.getAllSongs = real
      }
      expect(text(el)).to.not.contain('to this export')
    })

    it('has nothing to do for a file that is what the space holds', async () => {
      const { el, db, file } = await repairedFile()
      await choose(el, new File([await createExport(db, 'Same')], 'same.zip'))
      await waitUntil(() => text(el).includes('Import this export'), 'the question')
      button(el, 'reset-start').click()
      await waitUntil(() => text(el).includes('to this export'), 'the plan')
      expect(button(el, 'reset-confirm').disabled).to.equal(true)
      expect(text(el)).to.contain('Nothing to change')
      expect(file.size).to.be.greaterThan(0)
    })

    it('says why a reset could not be made, and changes nothing', async () => {
      const { el, db, song, file } = await repairedFile()
      await choose(el, file)
      await waitUntil(() => text(el).includes('Import this export'), 'the question')
      button(el, 'reset-start').click()
      await waitUntil(() => text(el).includes('to this export'), 'the plan')
      const real = ChordlessDB.prototype.saveChordPro
      ChordlessDB.prototype.saveChordPro = async () => {
        throw new Error('disk full')
      }
      try {
        button(el, 'reset-confirm').click()
        await waitUntil(() => text(el).includes('Resetting failed: disk full'), 'the failure')
      } finally {
        ChordlessDB.prototype.saveChordPro = real
      }
      expect(must(await db.getChordPro(song.chordproFileId)).content).to.equal(ALPHA)
    })
  })

  it('exports and imports for the space it is given, not the one in use', async () => {
    const other = await createSpace(`Other ${crypto.randomUUID().slice(0, 8)}`)
    try {
      const db = new ChordlessDB(other.id)
      await db.init()
      await addChart(db, ALPHA, ADD)
      db.db?.close()
      const el = await fixture<SpaceExportPanel>(
        html`<space-export-panel .space=${other}></space-export-panel>`
      )
      button(el, 'export-space').click()
      await waitUntil(() => downloads.length === 1, 'the download')
      expect(downloads[0]?.name).to.contain(other.name.replace(/ /g, '-'))

      let imported = 0
      el.addEventListener(SpaceImportedEvent.type, () => imported++)
      await choose(el, await exportOf('Elsewhere'))
      await waitUntil(() => text(el).includes('Import this export'), 'the question')
      expect(text(el)).to.contain(`into ${other.name}`)
      button(el, 'import').click()
      await waitUntil(() => text(el).includes(`Imported into ${other.name}`), 'the import')
      expect(imported).to.equal(1)
      const there = new ChordlessDB(other.id)
      await there.init()
      expect(await there.getAllSetlists()).to.have.length(1)
      there.db?.close()
      // (the space in use is untouched)
      expect(await (await getCurrentDB()).getAllSetlists()).to.have.length(0)
    } finally {
      await deleteSpace(other.id)
    }
  })

  it('goes back to the choice of file when the question is cancelled', async () => {
    const el = await mount()
    await choose(el, await exportOf('Elsewhere', false))
    await waitUntil(() => text(el).includes('Import this export'), 'the question')
    button(el, 'import-cancel').click()
    await el.updateComplete
    expect(text(el)).to.not.contain('Import this export')
  })

  it('says a file that is not an export is not one, and asks nothing', async () => {
    const el = await mount()
    await choose(el, new File(['hello'], 'notes.zip'))
    await waitUntil(() => text(el).includes('not a ZIP file'), 'the reason')
    expect(text(el)).to.not.contain('Import this export')
    // Choosing nothing does nothing
    const input = must(el.shadowRoot?.querySelector<HTMLInputElement>('input[type=file]'))
    input.dispatchEvent(new Event('change'))
  })

  it('says why an import failed, and changes nothing', async () => {
    const el = await mount()
    await choose(el, await exportOf('Elsewhere'))
    await waitUntil(() => text(el).includes('Import this export'), 'the question')
    const db = await getCurrentDB()
    const real = Object.getPrototypeOf(db).saveSong
    Object.getPrototypeOf(db).saveSong = () => Promise.reject(new Error('disk full'))
    try {
      button(el, 'import').click()
      await waitUntil(() => text(el).includes('Importing failed'), 'the failure')
      expect(text(el)).to.contain('disk full')
    } finally {
      Object.getPrototypeOf(db).saveSong = real
    }
  })

  describe('signed in, with pad sets', () => {
    const audioOf = (key: string) =>
      new Uint8Array([...new TextEncoder().encode(`audio:${key}`), 0, 255])

    async function uploadSet(name: string) {
      return uploadPadSet(
        await buildZip(
          PAD_FILE_KEYS.map(key => ({ name: `${name} - ${key}.mp3`, data: audioOf(key) })),
          `${name}.zip`
        ),
        name
      )
    }

    it('shows their size, and puts them in the export only when ticked', async () => {
      await uploadSet('Warm')
      const el = await mount({ signedIn: true })
      await waitUntil(() => el.shadowRoot?.querySelector('#include-pads'), 'the choice')
      expect(text(el)).to.contain('Include my pad sets (1, about')

      button(el, 'export-space').click()
      await waitUntil(() => downloads.length === 1, 'the plain export')
      const plain = must(downloads[0]).size

      must(el.shadowRoot?.querySelector<HTMLInputElement>('#include-pads')).click()
      await el.updateComplete
      button(el, 'export-space').click()
      await waitUntil(() => downloads.length === 2, 'the export with pads')
      expect(must(downloads[1]).size).to.be.greaterThan(plain)
    })

    it('imports them to Drive only when ticked', async () => {
      const set = await uploadSet('Warm')
      const db = new ChordlessDB(`with-pads-${crypto.randomUUID()}`)
      await db.init()
      const { readPadSetsForExport } = await import('../src/js/space-export.ts')
      const file = new File(
        [await createExport(db, 'S', await readPadSetsForExport([set]))],
        'b.zip'
      )
      db.db?.close()
      await deleteDatabase(db.dbName)
      for (const f of drive.listFiles((each: any) => each.parents?.includes(set.id))) {
        drive.files.delete(f.id)
      }
      drive.files.delete(set.id)

      const el = await mount({ signedIn: true })
      await choose(el, file)
      await waitUntil(() => text(el).includes('Import this export'), 'the question')
      expect(text(el)).to.contain('1 pad sets')
      button(el, 'import').click()
      await waitUntil(() => text(el).includes('Imported into'), 'the import')
      expect(text(el)).to.not.contain('pad sets uploaded')

      await choose(el, file)
      await waitUntil(() => text(el).includes('Import this export'), 'the question')
      must(el.shadowRoot?.querySelector<HTMLInputElement>('#import-pads')).click()
      await el.updateComplete
      button(el, 'import').click()
      await waitUntil(() => text(el).includes('1 pad sets uploaded to Drive'), 'the pads')
    })

    it('cannot import pad sets when not signed in', async () => {
      const set = await uploadSet('Warm')
      const db = new ChordlessDB(`with-pads-${crypto.randomUUID()}`)
      await db.init()
      const { readPadSetsForExport } = await import('../src/js/space-export.ts')
      const file = new File(
        [await createExport(db, 'S', await readPadSetsForExport([set]))],
        'b.zip'
      )
      db.db?.close()
      await deleteDatabase(db.dbName)
      const el = await mount()
      await choose(el, file)
      await waitUntil(() => text(el).includes('Import this export'), 'the question')
      expect(
        must(el.shadowRoot?.querySelector<HTMLInputElement>('#import-pads')).disabled
      ).to.equal(true)
      expect(text(el)).to.contain('connect with Google first')
    })

    it('leaves out the pad sets when Drive cannot be asked', async () => {
      drive.failRequests({ method: 'GET', status: 500, times: 50 })
      const el = await mount({ signedIn: true })
      await wait(100)
      expect(el.shadowRoot?.querySelector('#include-pads')).to.equal(null)
      // and when the user signs out
      el.signedIn = false
      await el.updateComplete
      expect(el.shadowRoot?.querySelector('#include-pads')).to.equal(null)
    })
  })
})

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
