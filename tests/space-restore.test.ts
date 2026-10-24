import { expect } from '@open-wc/testing'
import { generateShareKey } from '../src/js/share-crypto.ts'
import { hashText } from '../src/js/song-utils.ts'
import { createExport, readExport, type SpaceExport } from '../src/js/space-export.ts'
import { planReset, resetToExport } from '../src/js/space-restore.ts'
import { makeEntry } from './builders.ts'
import { addSong, useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

const NUMBERS = '{title: Alpha}\n{key: C}\n[1]Alpha [4]line'
const LETTERS = '{title: Alpha}\n{key: G}\n[G]Alpha [C]line'
const BETA = '{title: Beta}\n{key: D}\n[D]Beta line'

describe('Reset from import (resetToExport)', () => {
  const rig = useSyncRig()
  const { makeDevice, addSetlist, syncDevice } = rig

  /** A device with a synced library: Alpha (as numbers) and Beta, and a setlist with both */
  async function library() {
    const phone = await makeDevice('phone')
    await addSong(phone, { uuid: 'alpha', title: 'Alpha', content: NUMBERS })
    await addSong(phone, { uuid: 'beta', title: 'Beta', content: BETA })
    const setlist = await addSetlist(phone, {
      name: 'Sunday',
      songs: [
        makeEntry({ songId: 'title-alpha', songUuid: 'alpha', key: 'G' }),
        makeEntry({ songId: 'title-beta', songUuid: 'beta', key: 'D', order: 1 }),
      ],
    })
    await syncDevice(phone)
    return { phone, setlist }
  }

  /** What the space holds now, as a file read back */
  async function fileOf(phone: { db: Parameters<typeof createExport>[0] }): Promise<SpaceExport> {
    return readExport(new Blob([await createExport(phone.db, 'Space')]))
  }

  /** The file with one chart's text replaced, as a repair made off to the side would */
  function withChart(exported: SpaceExport, uuid: string, content: string): SpaceExport {
    const song = must(exported.songs.find(s => s.uuid === uuid))
    exported.chordpro.set(song.chordproFileId, content)
    song.contentHash = hashText(content)
    return exported
  }

  it('plans nothing for a file that is what the space holds', async () => {
    const { phone } = await library()
    const plan = await planReset(await fileOf(phone), phone.db)
    expect(plan).to.deep.include({
      songsSame: 2,
      songsOnlyHere: 0,
      setlistsSame: 1,
      setlistsOnlyHere: 0,
    })
    expect(plan.songsReplaced).to.have.length(0)
    expect(plan.setlistsReplaced).to.have.length(0)
  })

  it('replaces a changed chart in place: same song, same chart record, same file in Drive', async () => {
    const { phone } = await library()
    const before = must(await phone.db.getSong('alpha'))
    const repaired = withChart(await fileOf(phone), 'alpha', LETTERS)

    const report = await resetToExport(repaired, phone.db)

    expect(report).to.deep.include({ songsReplaced: 1, songsAdded: 0, songsSame: 1 })
    const after = must(await phone.db.getSong('alpha'))
    expect(after.uuid).to.equal('alpha')
    expect(after.chordproFileId).to.equal(before.chordproFileId)
    expect(after.fileRef, 'the link to its file in Drive').to.equal(before.fileRef)
    expect(must(await phone.db.getChordPro(after.chordproFileId)).content).to.equal(LETTERS)
    expect(after.contentHash).to.equal(hashText(LETTERS))
  })

  it('sends the replaced chart as an update of the same Drive file, and another device gets it', async () => {
    const { phone } = await library()
    const filesBefore = rig.storage.list(() => true).length
    await resetToExport(withChart(await fileOf(phone), 'alpha', LETTERS), phone.db)

    await syncDevice(phone)

    const files = rig.storage.list(() => true)
    expect(files, 'no file is added').to.have.length(filesBefore)
    expect(files.some(file => file.content.includes('[G]Alpha [C]line'))).to.equal(true)
    expect(files.some(file => file.content.includes('[1]Alpha'))).to.equal(false)

    const tablet = await makeDevice('tablet')
    await syncDevice(tablet)
    const song = must(await tablet.db.getSong('alpha'))
    expect(must(await tablet.db.getChordPro(song.chordproFileId)).content).to.equal(LETTERS)
  })

  it('leaves what is the same alone', async () => {
    const { phone } = await library()
    const before = must(await phone.db.getSong('beta'))
    await resetToExport(withChart(await fileOf(phone), 'alpha', LETTERS), phone.db)
    expect(must(await phone.db.getSong('beta'))).to.deep.equal(before)
  })

  it('adds a chart and a setlist the space lacks, with their ids, and keeps what is only here', async () => {
    const { phone, setlist } = await library()
    const file = await fileOf(phone)
    // (the file is of a space with Gamma and no Beta, and a setlist the space does not have)
    const other = await makeDevice('other')
    await addSong(other, { uuid: 'gamma', title: 'Gamma', content: '{title: Gamma}\n[A]Gamma' })
    await addSetlist(other, {
      id: 'set-gamma',
      name: 'Gamma night',
      songs: [makeEntry({ songId: 'title-gamma', songUuid: 'gamma' })],
    })
    const gamma = await fileOf(other)
    file.songs = file.songs.filter(s => s.uuid !== 'beta').concat(gamma.songs)
    for (const [name, content] of gamma.chordpro) file.chordpro.set(name, content)
    file.setlists = file.setlists.concat(gamma.setlists)

    const report = await resetToExport(file, phone.db)

    expect(report).to.deep.include({
      songsAdded: 1,
      songsOnlyHere: 1,
      setlistsAdded: 1,
      setlistsSame: 1,
    })
    expect(must(await phone.db.getSong('gamma')).title).to.equal('Gamma')
    expect(must(await phone.db.getSong('beta')).title, 'only here: kept').to.equal('Beta')
    expect(must(await phone.db.getSetlist('set-gamma')).songs[0].songUuid).to.equal('gamma')
    expect(must(await phone.db.getSetlist(setlist.id)).name).to.equal('Sunday')
  })

  it('replaces a changed setlist but keeps its file in Drive and its share link', async () => {
    const { phone, setlist } = await library()
    await phone.db.updateSetlist(setlist.id, draft => {
      draft.share = {
        fileId: 'share-file',
        key: generateShareKey(),
        created: '2026-10-01',
        expires: '2999-01-01',
        bundleHash: 'old',
      }
    })
    const before = must(await phone.db.getSetlist(setlist.id))
    const file = await fileOf(phone)
    file.setlists[0].name = 'Sunday (fixed)'

    const report = await resetToExport(file, phone.db)

    expect(report.setlistsReplaced).to.equal(1)
    const after = must(await phone.db.getSetlist(setlist.id))
    expect(after.name).to.equal('Sunday (fixed)')
    expect(after.fileRef).to.equal(before.fileRef)
    expect(after.syncedContentHash).to.equal(before.syncedContentHash)
    expect(after.share).to.deep.equal(before.share)

    await syncDevice(phone)
    expect(rig.driveSetlist(setlist.id).name).to.equal('Sunday (fixed)')
    expect(rig.driveSetlistFiles()).to.have.length(1)
  })

  it('brings back a setlist deleted here that the file has', async () => {
    const { phone, setlist } = await library()
    const file = await fileOf(phone)
    await phone.db.updateSetlist(setlist.id, draft => {
      draft.deletedAt = new Date().toISOString()
    })

    const report = await resetToExport(file, phone.db)

    expect(report.setlistsAdded).to.equal(1)
    expect(must(await phone.db.getSetlist(setlist.id)).deletedAt).to.equal(undefined)
  })

  it('says which changes it undoes: those made here after the file was made', async () => {
    const { phone } = await library()
    const file = await fileOf(phone)
    const old = '2020-01-01T00:00:00.000Z'
    must(file.songs.find(s => s.uuid === 'alpha')).modifiedDate = old
    withChart(file, 'alpha', LETTERS)
    const plan = await planReset(file, phone.db)
    expect(plan.songsReplaced).to.deep.equal([{ id: 'alpha', label: 'Alpha', newerHere: true }])

    must(file.songs.find(s => s.uuid === 'alpha')).modifiedDate = '2999-01-01T00:00:00.000Z'
    const later = await planReset(file, phone.db)
    expect(later.songsReplaced[0].newerHere).to.equal(false)
  })

  it('does nothing twice: a second reset to the same file finds it all the same', async () => {
    const { phone } = await library()
    const file = withChart(await fileOf(phone), 'alpha', LETTERS)
    await resetToExport(file, phone.db)
    const again = await resetToExport(file, phone.db)
    expect(again).to.deep.include({ songsReplaced: 0, songsAdded: 0, setlistsReplaced: 0 })
  })

  it('skips a chart whose text the file does not hold, and goes on with the rest', async () => {
    const { phone } = await library()
    const file = withChart(await fileOf(phone), 'alpha', LETTERS)
    withChart(file, 'beta', '{title: Beta}\n[E]Beta changed')
    file.chordpro.delete(must(file.songs.find(s => s.uuid === 'alpha')).chordproFileId)

    const report = await resetToExport(file, phone.db)

    expect(report.songsReplaced, 'both were planned').to.equal(2)
    const alpha = must(await phone.db.getSong('alpha'))
    expect(must(await phone.db.getChordPro(alpha.chordproFileId)).content).to.equal(NUMBERS)
    const beta = must(await phone.db.getSong('beta'))
    expect(must(await phone.db.getChordPro(beta.chordproFileId)).content).to.contain('Beta changed')
  })
})
