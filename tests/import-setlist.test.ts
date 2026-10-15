/** Making a setlist from a reviewed email, in a database (the choosing is in import-plan.node.test.ts) */
import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import {
  copyFromElsewhere,
  createImportedSetlist,
  libraryForMatching,
  type ReviewedSong,
  updateImportedSetlist,
} from '../src/js/import-setlist.ts'
import { getSongsElsewhere } from '../src/js/other-songs.ts'
import { SHARED_DB_ID } from '../src/js/share-receiver.ts'
import { addChart, createVariant } from '../src/js/song-utils.ts'
import { makeEntry, makeImportedSong, makeSetlist } from './builders.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const ALPHA = '{title: Alpha}\n{key: G}\n{ccli: 111}\n[G]Alpha line one'
const BETA = '{title: Beta}\n{key: D}\n[D]Beta line one'
const ADD = { variantLabel: 'Test', importSource: 'test', makeDefault: 'first' } as const

describe('importing a setlist into the library', () => {
  const libraryId = `org-${crypto.randomUUID()}`
  let library: ChordlessDB
  let shared: ChordlessDB

  beforeEach(async () => {
    library = new ChordlessDB(libraryId)
    await library.init()
    shared = new ChordlessDB(SHARED_DB_ID)
    await shared.init()
  })

  afterEach(async () => {
    library.db?.close()
    shared.db?.close()
    await deleteDatabase(libraryId)
    await deleteDatabase(SHARED_DB_ID)
  })

  describe('the songs to match with', () => {
    it('are the library’s, each with the words of its chart', async () => {
      await addChart(library, ALPHA, ADD)
      const songs = await libraryForMatching(library)
      expect(songs).to.have.length(1)
      expect(songs[0]).to.include({ id: 'ccli-111', title: 'Alpha', ccli: '111' })
      expect(songs[0].lyrics).to.contain('alpha line one')
    })

    it('are one for each song, its default variant when it has several', async () => {
      const first = await addChart(library, ALPHA, ADD)
      await createVariant(first.uuid, '{title: Alpha}\n{ccli: 111}\n[A]Alpha other words', {
        variantLabel: 'Other',
      } as never).catch(() => undefined)
      const songs = await libraryForMatching(library)
      expect(songs.filter(song => song.id === 'ccli-111')).to.have.length(1)
    })

    it('read a chart once, from the cache after that', async () => {
      await addChart(library, ALPHA, ADD)
      const cache = new Map<string, string>()
      await libraryForMatching(library, cache)
      expect(cache.size).to.equal(1)
      const [key] = cache.keys()
      cache.set(key, 'from the cache')
      expect((await libraryForMatching(library, cache))[0].lyrics).to.equal('from the cache')
    })

    it('have no words for a chart that is missing', async () => {
      const record = await addChart(library, ALPHA, ADD)
      await library.db
        ?.transaction('chordpro', 'readwrite')
        .objectStore('chordpro')
        .delete(record.chordproFileId)
      expect((await libraryForMatching(library))[0].lyrics).to.equal('')
    })

    it('include the songs of other databases that the library has not, marked with where from', async () => {
      await addChart(library, ALPHA, ADD)
      await addChart(shared, ALPHA.replace('Alpha line one', 'Shared alpha'), ADD)
      await addChart(shared, BETA, ADD)
      const elsewhere = await getSongsElsewhere(libraryId)
      const songs = await libraryForMatching(library, new Map(), elsewhere)
      expect(songs.map(song => song.title).sort()).to.deep.equal(['Alpha', 'Beta'])
      const beta = must(songs.find(song => song.title === 'Beta'))
      expect(beta.source?.dbId).to.equal(SHARED_DB_ID)
      expect(beta.lyrics).to.contain('beta line one')
      expect(must(songs.find(song => song.title === 'Alpha')).source).to.equal(undefined)
    })
  })

  describe('copying the songs of other databases', () => {
    const reviewedOf = (library: ReviewedSong['library'], title = library.title): ReviewedSong => ({
      song: makeImportedSong(title),
      key: null,
      notes: '',
      library,
    })

    it('leaves the library’s own songs, and copies another’s into the library once', async () => {
      const own = await addChart(library, ALPHA, ADD)
      await addChart(shared, BETA, ADD)
      const elsewhere = await getSongsElsewhere(libraryId)
      const [beta] = elsewhere
      const fromElsewhere = {
        uuid: beta.uuid,
        id: beta.id,
        title: beta.title,
        ccli: null,
        source: beta.source,
      }
      const reviewed = [
        reviewedOf({ uuid: own.uuid, id: own.id, title: 'Alpha', ccli: '111' }),
        reviewedOf(fromElsewhere),
        reviewedOf(fromElsewhere, 'Beta again'),
      ]
      const result = await copyFromElsewhere(library, reviewed, elsewhere)
      expect(result[0].library.uuid).to.equal(own.uuid)
      expect(result[1].library.source).to.equal(undefined)
      expect(result[1].library.uuid).to.not.equal(beta.uuid)
      expect(result[2].library.uuid).to.equal(result[1].library.uuid)
      const titles = (await library.getAllSongs()).map(song => song.title).sort()
      expect(titles).to.deep.equal(['Alpha', 'Beta'])
    })

    it('says so when the song has gone from where it was', async () => {
      let message = ''
      try {
        await copyFromElsewhere(
          library,
          [
            reviewedOf({
              uuid: 'gone',
              id: 'title-gone',
              title: 'Gone',
              ccli: null,
              source: { dbId: SHARED_DB_ID, label: 'Shared with me' },
            }),
          ],
          []
        )
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.equal('Gone is no longer in Shared with me')
    })
  })

  describe('making the setlist', () => {
    const song = (
      id: string,
      uuid: string,
      key: string | null,
      notes = '',
      tempo: number | null = null
    ): ReviewedSong => ({
      song: makeImportedSong(id, { tempo }),
      key,
      notes,
      library: { uuid, id, title: id, ccli: null },
    })

    it('keeps the songs in order, with their key, tempo and note, in the library', async () => {
      const setlist = await createImportedSetlist(
        library,
        { name: 'Imported', date: '2026-11-01' },
        [song('a', 'ua', 'G', 'repeat', 90), song('b', 'ub', null)]
      )
      expect(
        setlist.songs.map(entry => [
          entry.order,
          entry.songId,
          entry.songUuid,
          entry.key,
          entry.tempo,
          entry.notes,
        ])
      ).to.deep.equal([
        [0, 'a', 'ua', 'G', 90, 'repeat'],
        [1, 'b', 'ub', null, null, ''],
      ])
      expect((await library.getSetlist(setlist.id))?.name).to.equal('Imported')
    })

    describe('updating one that is there', () => {
      const existing = () =>
        makeSetlist({
          id: 'existing',
          name: 'Keep my name',
          songs: [
            makeEntry({
              order: 0,
              songId: 'a',
              songUuid: 'ua',
              key: 'G',
              tempo: 80,
              notes: 'mine',
            }),
            makeEntry({ order: 1, songId: 'b', songUuid: 'ub', key: 'D', tempo: null, notes: '' }),
            makeEntry({ order: 2, songId: 'c', songUuid: 'uc', key: 'A', tempo: null, notes: '' }),
          ],
        })

      it('takes the email’s order, key and notes where it has them, and keeps what the setlist knew', async () => {
        const updated = await updateImportedSetlist(library, existing(), [
          song('b', 'ub', 'E', 'new note'),
          song('a', 'ua', null, ''),
          song('d', 'ud', 'C', '', 120),
        ])
        expect(updated.name).to.equal('Keep my name')
        expect(updated.songs.map(entry => entry.songId)).to.deep.equal(['b', 'a', 'd'])
        const [b, a, d] = updated.songs
        expect([b.key, b.notes]).to.deep.equal(['E', 'new note'])
        expect([a.key, a.tempo, a.notes]).to.deep.equal(['G', 80, 'mine'])
        expect([d.songUuid, d.key, d.tempo]).to.deep.equal(['ud', 'C', 120])
        expect(updated.songs.map(entry => entry.order)).to.deep.equal([0, 1, 2])
        expect((await library.getSetlist('existing'))?.songs).to.have.length(3)
      })

      it('puts the songs only the setlist had, and was told to keep, at the end', async () => {
        const updated = await updateImportedSetlist(
          library,
          existing(),
          [song('b', 'ub', null)],
          new Set(['c', 'a'])
        )
        expect(updated.songs.map(entry => entry.songId)).to.deep.equal(['b', 'a', 'c'])
      })

      it('gives a new song no key or tempo when neither has one', async () => {
        const updated = await updateImportedSetlist(library, existing(), [song('z', 'uz', null)])
        expect([updated.songs[0].key, updated.songs[0].tempo]).to.deep.equal([null, null])
      })
    })
  })
})
