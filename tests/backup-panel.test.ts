import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import { type BackupPanel, megabytes } from '../src/components/backup-panel.ts'
import { createBackup } from '../src/js/backup.ts'
import { ChordlessDB, getCurrentDB } from '../src/js/db.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  setCurrentOrganisation,
} from '../src/js/organisation.ts'
import { PAD_FILE_KEYS } from '../src/js/pad-keys.ts'
import { uploadPadSet } from '../src/js/pad-set-service.ts'
import { addChart } from '../src/js/song-utils.ts'
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

describe('the backup panel', () => {
  let before: { id: string | null; name: string }
  let spaceId: string
  let drive: ReturnType<typeof installFakeDrive>
  let realClick: typeof HTMLAnchorElement.prototype.click
  let downloads: { name: string; size: number }[]

  beforeEach(async () => {
    drive = installFakeDrive()
    before = getCurrentOrganisation()
    const space = await createOrganisation(`Backup ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentOrganisation(space.id, space.name)
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
    await deleteOrganisation(spaceId)
    if (before.id) await setCurrentOrganisation(before.id, before.name)
  })

  const text = (el: BackupPanel) => el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''
  const button = (el: BackupPanel, id: string) =>
    must(el.shadowRoot?.querySelector<HTMLButtonElement>(`#${id}`))

  /** A space's backup file, from a database made for it */
  async function backupOf(name: string, fill = true) {
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
      return new File([await createBackup(db, name)], 'backup.zip')
    } finally {
      db.db?.close()
      await deleteDatabase(id)
    }
  }

  async function choose(el: BackupPanel, file: File) {
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

  it('does nothing when asked to restore with no backup chosen', async () => {
    const el = await fixture<BackupPanel>(html`<backup-panel></backup-panel>`)
    await el._restore()
    expect(text(el)).to.not.contain('Restored')
  })

  it('offers no pad sets when not signed in', async () => {
    const el = await fixture<BackupPanel>(html`<backup-panel></backup-panel>`)
    expect(el.shadowRoot?.querySelector('#include-pads')).to.equal(null)
    expect(text(el)).to.contain('Download a backup')
  })

  it('downloads a backup of the current space, named by space and day', async () => {
    const db = await getCurrentDB()
    await addChart(db, ALPHA, ADD)
    const el = await fixture<BackupPanel>(html`<backup-panel></backup-panel>`)
    button(el, 'download-backup').click()
    await waitUntil(() => downloads.length === 1, 'the download')
    expect(downloads[0]?.name).to.match(
      /^chordless-backup-Backup-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}\.zip$/
    )
    expect(downloads[0]?.size).to.be.greaterThan(100)
    expect(text(el)).to.contain('Backup saved as chordless-backup-')
  })

  it('says why a backup could not be made', async () => {
    const db = await getCurrentDB()
    const real = Object.getPrototypeOf(db).getAllSongs
    Object.getPrototypeOf(db).getAllSongs = () => Promise.reject(new Error('disk full'))
    try {
      const el = await fixture<BackupPanel>(html`<backup-panel></backup-panel>`)
      button(el, 'download-backup').click()
      await waitUntil(() => text(el).includes('Making the backup failed'), 'the failure')
      expect(text(el)).to.contain('disk full')
    } finally {
      Object.getPrototypeOf(db).getAllSongs = real
    }
  })

  it('restores into this space, and says what was added and what was already there', async () => {
    const file = await backupOf('Elsewhere')
    const el = await fixture<BackupPanel>(html`<backup-panel></backup-panel>`)
    await choose(el, file)
    await waitUntil(() => text(el).includes('Restore this backup'), 'the question')
    expect(text(el)).to.contain('Backup of Elsewhere')
    expect(text(el)).to.contain('1 charts, 1 setlists')

    button(el, 'restore').click()
    await waitUntil(() => text(el).includes('Restored into this space'), 'the restore')
    expect(text(el)).to.contain('1 charts and 1 setlists added')
    const db = await getCurrentDB()
    expect(await db.getAllSongs()).to.have.length(1)
    expect(must(await db.getSetlist('set-9')).songs[0]?.key).to.equal('A')

    // Again: nothing to add
    await choose(el, file)
    await waitUntil(() => text(el).includes('Restore this backup'), 'the question')
    button(el, 'restore').click()
    await waitUntil(() => text(el).includes('0 charts and 0 setlists added'), 'the second restore')
    expect(text(el)).to.contain('1 charts and 1 setlists were already there')
  })

  it('goes back to the choice of file when the question is cancelled', async () => {
    const el = await fixture<BackupPanel>(html`<backup-panel></backup-panel>`)
    await choose(el, await backupOf('Elsewhere', false))
    await waitUntil(() => text(el).includes('Restore this backup'), 'the question')
    button(el, 'restore-cancel').click()
    await el.updateComplete
    expect(text(el)).to.not.contain('Restore this backup')
  })

  it('says a file that is not a backup is not one, and asks nothing', async () => {
    const el = await fixture<BackupPanel>(html`<backup-panel></backup-panel>`)
    await choose(el, new File(['hello'], 'notes.zip'))
    await waitUntil(() => text(el).includes('not a ZIP file'), 'the reason')
    expect(text(el)).to.not.contain('Restore this backup')
    // Choosing nothing does nothing
    const input = must(el.shadowRoot?.querySelector<HTMLInputElement>('input[type=file]'))
    input.dispatchEvent(new Event('change'))
  })

  it('says why a restore failed, and changes nothing', async () => {
    const el = await fixture<BackupPanel>(html`<backup-panel></backup-panel>`)
    await choose(el, await backupOf('Elsewhere'))
    await waitUntil(() => text(el).includes('Restore this backup'), 'the question')
    const db = await getCurrentDB()
    const real = Object.getPrototypeOf(db).saveSong
    Object.getPrototypeOf(db).saveSong = () => Promise.reject(new Error('disk full'))
    try {
      button(el, 'restore').click()
      await waitUntil(() => text(el).includes('Restoring failed'), 'the failure')
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

    it('shows their size, and puts them in the backup only when ticked', async () => {
      await uploadSet('Warm')
      const el = await fixture<BackupPanel>(html`<backup-panel signed-in></backup-panel>`)
      await waitUntil(() => el.shadowRoot?.querySelector('#include-pads'), 'the choice')
      expect(text(el)).to.contain('Include my pad sets (1, about')

      button(el, 'download-backup').click()
      await waitUntil(() => downloads.length === 1, 'the plain backup')
      const plain = must(downloads[0]).size

      must(el.shadowRoot?.querySelector<HTMLInputElement>('#include-pads')).click()
      await el.updateComplete
      button(el, 'download-backup').click()
      await waitUntil(() => downloads.length === 2, 'the backup with pads')
      expect(must(downloads[1]).size).to.be.greaterThan(plain)
    })

    it('restores them to Drive only when ticked', async () => {
      const set = await uploadSet('Warm')
      const db = new ChordlessDB(`with-pads-${crypto.randomUUID()}`)
      await db.init()
      const { readPadSetsForBackup } = await import('../src/js/backup.ts')
      const file = new File(
        [await createBackup(db, 'S', await readPadSetsForBackup([set]))],
        'b.zip'
      )
      db.db?.close()
      await deleteDatabase(db.dbName)
      for (const f of drive.listFiles((each: any) => each.parents?.includes(set.id))) {
        drive.files.delete(f.id)
      }
      drive.files.delete(set.id)

      const el = await fixture<BackupPanel>(html`<backup-panel signed-in></backup-panel>`)
      await choose(el, file)
      await waitUntil(() => text(el).includes('Restore this backup'), 'the question')
      expect(text(el)).to.contain('1 pad sets')
      button(el, 'restore').click()
      await waitUntil(() => text(el).includes('Restored into'), 'the restore')
      expect(text(el)).to.not.contain('pad sets uploaded')

      await choose(el, file)
      await waitUntil(() => text(el).includes('Restore this backup'), 'the question')
      must(el.shadowRoot?.querySelector<HTMLInputElement>('#restore-pads')).click()
      await el.updateComplete
      button(el, 'restore').click()
      await waitUntil(() => text(el).includes('1 pad sets uploaded to Drive'), 'the pads')
    })

    it('cannot restore pad sets when not signed in', async () => {
      const set = await uploadSet('Warm')
      const db = new ChordlessDB(`with-pads-${crypto.randomUUID()}`)
      await db.init()
      const { readPadSetsForBackup } = await import('../src/js/backup.ts')
      const file = new File(
        [await createBackup(db, 'S', await readPadSetsForBackup([set]))],
        'b.zip'
      )
      db.db?.close()
      await deleteDatabase(db.dbName)
      const el = await fixture<BackupPanel>(html`<backup-panel></backup-panel>`)
      await choose(el, file)
      await waitUntil(() => text(el).includes('Restore this backup'), 'the question')
      expect(
        must(el.shadowRoot?.querySelector<HTMLInputElement>('#restore-pads')).disabled
      ).to.equal(true)
      expect(text(el)).to.contain('connect with Google first')
    })

    it('leaves out the pad sets when Drive cannot be asked', async () => {
      drive.failRequests({ method: 'GET', status: 500, times: 50 })
      const el = await fixture<BackupPanel>(html`<backup-panel signed-in></backup-panel>`)
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
