/**
 * The versions of a song (song-versions.ts): which is the default, what each is called, folding one
 * song into another as a variant of it, and deleting a variant: what the songs and the setlists
 * that use them look like afterwards.
 */
import { expect } from '@open-wc/testing'
import type { SongRecord } from '../src/js/data-types.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { hashText } from '../src/js/song-utils.ts'
import {
  deleteOnlyVersion,
  deleteVariant,
  detailsOf,
  linkSong,
  makeDefault,
  renameVariant,
  setlistsUsing,
  variantsOf,
  withDetails,
} from '../src/js/song-versions.ts'
import { makeEntry, makeSetlist, makeSong } from './builders.ts'
import { must } from './must.ts'
import { deleteDatabase, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('the versions of a song', () => {
  let db: ChordlessDB
  let dbName: string

  beforeEach(async () => {
    dbName = `versions-${crypto.randomUUID()}`
    db = new ChordlessDB(dbName)
    await db.init()
  })

  afterEach(async () => {
    must(db.db).close()
    await deleteDatabase(dbName)
  })

  const add = (uuid: string, overrides: Partial<SongRecord> = {}) =>
    db.saveSong({
      ...makeSong({
        uuid,
        id: 'ccli-1',
        ccliNumber: '1',
        title: 'Amazing',
        titleNormalized: 'amazing',
        variantLabel: 'Original',
        importDate: '2026-01-01',
        key: 'G',
        ...overrides,
      }),
    })
  const get = async (uuid: string) => must(await db.getSong(uuid))

  describe('listing, renaming and the default', () => {
    it('lists the default first, then the oldest first', async () => {
      await add('newer', { isDefault: false, importDate: '2026-03-01' })
      await add('older', { isDefault: false, importDate: '2026-02-01' })
      await add('default', { isDefault: true, importDate: '2026-04-01' })
      expect((await variantsOf(db, 'ccli-1')).map(song => song.uuid)).to.deep.equal([
        'default',
        'older',
        'newer',
      ])
    })

    it('renames a variant, with nothing meaning "Original", and marks it changed for sync', async () => {
      await add('a')
      expect((await renameVariant(db, 'a', '  Capo 3  ')).variantLabel).to.equal('Capo 3')
      expect((await get('a')).metadataChangedAt).to.be.a('string')
      expect((await renameVariant(db, 'a', ' ')).variantLabel).to.equal('Original')
      let failure = ''
      await renameVariant(db, 'nobody', 'x').catch(error => {
        failure = error.message
      })
      expect(failure).to.contain('Song not found')
    })

    it('makes another variant the default, marking both changed', async () => {
      await add('a')
      await add('b', { isDefault: false, variantOf: 'a' })
      await makeDefault(db, 'b')
      expect((await get('a')).isDefault).to.equal(false)
      expect((await get('b')).isDefault).to.equal(true)
      expect((await get('a')).metadataChangedAt).to.be.a('string')
      expect((await get('b')).metadataChangedAt).to.be.a('string')
    })
  })

  describe('folding one song into another', () => {
    const handMade = (extra: Partial<SongRecord> = {}) =>
      add('hand', {
        id: 'title-amazing',
        ccliNumber: null,
        title: 'amazing',
        variantLabel: 'Original',
        ...extra,
      })

    it('makes the song a variant of the other with its identity, and the setlists keep their songs', async () => {
      await add('official', { importDate: '2026-02-01' })
      await handMade()
      const setlist = makeSetlist({
        songs: [makeEntry({ songUuid: 'hand', songId: 'title-amazing' })],
      })
      await db.saveSetlist(setlist)

      await linkSong(db, 'title-amazing', 'ccli-1', 'Simon, capo 3')

      const hand = await get('hand')
      expect(hand.id).to.equal('ccli-1')
      expect(hand.ccliNumber).to.equal('1')
      expect(hand.title).to.equal('Amazing')
      expect(hand.isDefault).to.equal(false)
      expect(hand.variantOf).to.equal('official')
      expect(hand.variantLabel).to.equal('Simon, capo 3')
      expect(hand.metadataChangedAt).to.be.a('string')
      expect((await get('official')).isDefault).to.equal(true)
      expect(must(await db.getSetlist(setlist.id)).songs[0]).to.include({
        songUuid: 'hand',
        songId: 'ccli-1',
      })
      expect((await variantsOf(db, 'ccli-1')).map(song => song.uuid)).to.deep.equal([
        'official',
        'hand',
      ])
      expect(await variantsOf(db, 'title-amazing')).to.deep.equal([])
    })

    it('calls it what it was called, else "Alternate", when no name is given', async () => {
      await add('official')
      await handMade({ variantLabel: 'Kings Kaleidoscope version' })
      await linkSong(db, 'title-amazing', 'ccli-1')
      expect((await get('hand')).variantLabel).to.equal('Kings Kaleidoscope version')

      await db.deleteSong('hand')
      await handMade()
      await linkSong(db, 'title-amazing', 'ccli-1')
      expect((await get('hand')).variantLabel).to.equal('Alternate')
    })

    it("takes all of the song's variants, the others staying variants", async () => {
      await add('official')
      await handMade()
      await add('hand-two', {
        id: 'title-amazing',
        ccliNumber: null,
        isDefault: false,
        variantOf: 'hand',
        variantLabel: 'Capo',
      })
      await linkSong(db, 'title-amazing', 'ccli-1')
      expect((await variantsOf(db, 'ccli-1')).map(song => song.uuid).sort()).to.deep.equal([
        'hand',
        'hand-two',
        'official',
      ])
      expect((await get('hand-two')).isDefault).to.equal(false)
      expect((await get('hand-two')).variantOf).to.equal('hand')
      expect((await get('hand-two')).variantLabel).to.equal('Capo')
    })

    it('will not fold a song into itself, or into one that is not there', async () => {
      await add('official')
      const failure = async (from: string, into: string) => {
        let message = ''
        await linkSong(db, from, into).catch(error => {
          message = error.message
        })
        return message
      }
      expect(await failure('ccli-1', 'ccli-1')).to.contain('itself')
      expect(await failure('ccli-1', 'nothing')).to.contain('not found')
      expect(await failure('nothing', 'ccli-1')).to.contain('not found')
    })
  })

  describe('deleting a variant', () => {
    it('moves the setlists that used it to the default, keeping the key they showed, and deletes it', async () => {
      await add('default', { key: 'Eb' })
      await add('variant', { isDefault: false, variantOf: 'default', key: 'E', tempo: 70 })
      const setlist = makeSetlist({
        songs: [makeEntry({ songUuid: 'variant', songId: 'ccli-1', key: null, tempo: null })],
      })
      await db.saveSetlist(setlist)

      const kept = await deleteVariant(db, 'variant')

      expect(kept.uuid).to.equal('default')
      expect(await db.getSong('variant')).to.equal(undefined)
      expect(must(await db.getSetlist(setlist.id)).songs[0]).to.include({
        songUuid: 'default',
        key: 'E',
        tempo: 70,
      })
    })

    it('makes the oldest other variant the default when the default is deleted, and re-parents', async () => {
      await add('default')
      await add('old', { isDefault: false, variantOf: 'default', importDate: '2026-02-01' })
      await add('new', { isDefault: false, variantOf: 'default', importDate: '2026-03-01' })
      const kept = await deleteVariant(db, 'default')
      expect(kept.uuid).to.equal('old')
      expect(kept.isDefault).to.equal(true)
      expect(kept.variantOf).to.equal(null)
      expect((await get('new')).variantOf).to.equal('old')
      expect((await get('new')).metadataChangedAt).to.be.a('string')
    })

    it('leaves the others alone when a variant nothing hangs from is deleted', async () => {
      await add('default')
      await add('a', { isDefault: false, variantOf: 'default' })
      await add('b', { isDefault: false, variantOf: 'default' })
      await deleteVariant(db, 'a')
      expect((await get('b')).variantOf).to.equal('default')
      expect((await get('default')).metadataChangedAt).to.equal(undefined)
    })

    it("will not delete a song's only version, or one that is not there", async () => {
      await add('only')
      const failure = async (uuid: string) => {
        let message = ''
        await deleteVariant(db, uuid).catch(error => {
          message = error.message
        })
        return message
      }
      expect(await failure('only')).to.contain('at least one version')
      expect(await failure('nobody')).to.contain('Song not found')
      expect(await db.getSong('only')).to.not.equal(undefined)
    })
  })

  describe("deleting a song's only version", () => {
    it('deletes the song, taking it out of the setlists that have it, which close up', async () => {
      await add('gone')
      await add('stays', {
        id: 'ccli-2',
        ccliNumber: '2',
        title: 'Other',
        titleNormalized: 'other',
      })
      const has = makeSetlist({
        id: 'has',
        songs: [
          makeEntry({ songUuid: 'stays', songId: 'ccli-2', order: 0 }),
          makeEntry({ songUuid: 'gone', songId: 'ccli-1', order: 1 }),
          makeEntry({ songUuid: 'stays', songId: 'ccli-2', order: 2 }),
        ],
      })
      const hasNot = makeSetlist({
        id: 'has-not',
        songs: [makeEntry({ songUuid: 'stays', songId: 'ccli-2', order: 0 })],
      })
      await db.saveSetlist(has)
      await db.saveSetlist(hasNot)
      expect(await setlistsUsing(db, 'gone')).to.equal(1)

      expect(await deleteOnlyVersion(db, 'gone')).to.equal(1)

      expect(await db.getSong('gone')).to.equal(undefined)
      expect(
        must(await db.getSetlist('has')).songs.map(entry => [entry.songUuid, entry.order])
      ).to.deep.equal([
        ['stays', 0],
        ['stays', 1],
      ])
      expect(await setlistsUsing(db, 'gone')).to.equal(0)
      expect(await setlistsUsing(db, 'stays')).to.equal(2)
    })

    it('is not for a song with other versions, or a song that is not there', async () => {
      await add('a')
      await add('b', { isDefault: false, variantOf: 'a' })
      const failure = async (uuid: string) => {
        let message = ''
        await deleteOnlyVersion(db, uuid).catch(error => {
          message = error.message
        })
        return message
      }
      expect(await failure('a')).to.contain('other versions')
      expect(await failure('nobody')).to.contain('Song not found')
      expect(await db.getSong('a')).to.not.equal(undefined)
    })
  })

  describe('the details a chart gives', () => {
    it('are who wrote it, its copyright, tempo and time, from the directives', () => {
      expect(
        detailsOf(
          '{title: X}\n{artist: Keith Getty}\n{copyright: 2001 Thankyou}\n{tempo: 60}\n{time: 3/4}\n[G]x'
        )
      ).to.deep.equal({
        artist: 'Keith Getty',
        copyright: '2001 Thankyou',
        tempo: '60',
        time: '3/4',
      })
      expect(detailsOf('{title: X}\n{author: Jo}\n[G]x')).to.deep.equal({ artist: 'Jo' })
      expect(detailsOf('{title: X}\n{artist:  }\n[G]x')).to.deep.equal({})
    })

    it('are added under the title line, or at the top when there is none, or replace what is there', () => {
      expect(withDetails('{title: X}\n{key: G}\n[G]x', { artist: 'Jo', tempo: '60' })).to.equal(
        '{title: X}\n{artist: Jo}\n{tempo: 60}\n{key: G}\n[G]x'
      )
      expect(withDetails('[G]x', { time: '3/4' })).to.equal('{time: 3/4}\n[G]x')
      // (one it has is given the new value, in the directive it was in, as artist)
      expect(
        withDetails('{title: X}\n{author: Old}\n{tempo: 50}\n[G]x', { artist: 'New', tempo: '60' })
      ).to.equal('{title: X}\n{artist: New}\n{tempo: 60}\n[G]x')
      expect(withDetails('{title: X}\n[G]x', {})).to.equal('{title: X}\n[G]x')
    })
  })

  describe('folding one song into another, with the details each lacks', () => {
    const OFFICIAL =
      '{title: Amazing}\n{artist: Keith Getty}\n{copyright: 2001 Thankyou}\n{key: Eb}\n[Eb]Amazing grace'
    const HAND = '{title: Amazing}\n{tempo: 61 bpm}\n{copyright: Mine}\n{key: E}\n[E]Amazing grace'
    async function addChart(uuid: string, text: string, overrides: Partial<SongRecord> = {}) {
      await db.saveChordPro({
        id: `chordpro-${uuid}`,
        content: text,
        contentHash: hashText(text),
        lastModified: 1,
      })
      await add(uuid, {
        chordproFileId: `chordpro-${uuid}`,
        contentHash: hashText(text),
        ...overrides,
      })
    }
    const textOf = async (uuid: string) =>
      must(await db.getChordPro(must(await db.getSong(uuid)).chordproFileId)).content

    it('gives each chart what the other has and it lacks, and changes none it has, when neither is the authority', async () => {
      await addChart('official', OFFICIAL)
      await addChart('hand', HAND, { id: 'title-amazing', ccliNumber: null })

      await linkSong(db, 'title-amazing', 'ccli-1')

      expect(detailsOf(await textOf('hand'))).to.deep.equal({
        artist: 'Keith Getty',
        copyright: 'Mine',
        tempo: '61 bpm',
      })
      expect(detailsOf(await textOf('official'))).to.deep.equal({
        artist: 'Keith Getty',
        copyright: '2001 Thankyou',
        tempo: '61 bpm',
      })
      const hand = await get('hand')
      expect(hand.author).to.equal('Keith Getty')
      expect(hand.contentHash).to.equal(hashText(await textOf('hand')))
    })

    it('leaves a SongSelect chart as it is, and gives the other its details, replacing those that differ', async () => {
      await addChart('official', OFFICIAL, { importSource: 'songselect' })
      await addChart('hand', HAND, { id: 'title-amazing', ccliNumber: null })
      await linkSong(db, 'title-amazing', 'ccli-1')
      expect(await textOf('official')).to.equal(OFFICIAL)
      // (its artist and copyright; the tempo it has not got is not for it to give)
      expect(detailsOf(await textOf('hand'))).to.deep.equal({
        artist: 'Keith Getty',
        copyright: '2001 Thankyou',
        tempo: '61 bpm',
      })

      // ... whichever of the two is the SongSelect one
      await db.deleteSong('hand')
      await db.deleteSong('official')
      await addChart('hand2', HAND, {
        id: 'title-amazing',
        ccliNumber: null,
        importSource: 'songselect',
      })
      await addChart('official2', OFFICIAL)
      await linkSong(db, 'title-amazing', 'ccli-1')
      expect(await textOf('hand2')).to.equal(HAND)
      expect(detailsOf(await textOf('official2')).copyright).to.equal('Mine')
    })

    it('has no authority when both are from SongSelect, and gives only what is lacking', async () => {
      await addChart('official', OFFICIAL, { importSource: 'songselect' })
      await addChart('other', HAND, {
        id: 'title-amazing',
        ccliNumber: null,
        importSource: 'songselect',
      })
      await linkSong(db, 'title-amazing', 'ccli-1')
      expect(detailsOf(await textOf('other')).copyright).to.equal('Mine')
      expect(detailsOf(await textOf('official')).copyright).to.equal('2001 Thankyou')
      expect(detailsOf(await textOf('official')).tempo).to.equal('61 bpm')
    })

    it('does not change a detail that differs only in spacing or case', async () => {
      await addChart('official', OFFICIAL, { importSource: 'songselect' })
      const hand = '{title: Amazing}\n{copyright:  2001 THANKYOU }\n[E]x'
      await addChart('hand', hand, { id: 'title-amazing', ccliNumber: null })
      await linkSong(db, 'title-amazing', 'ccli-1')
      expect(detailsOf(await textOf('hand')).copyright).to.equal('2001 THANKYOU')
    })

    it('changes nothing when told not to, or when there is nothing to give', async () => {
      await addChart('official', OFFICIAL)
      await addChart('hand', HAND, { id: 'title-amazing', ccliNumber: null })
      await linkSong(db, 'title-amazing', 'ccli-1', '', { fillGaps: false })
      expect(await textOf('hand')).to.equal(HAND)
      expect(await textOf('official')).to.equal(OFFICIAL)

      await db.deleteSong('hand')
      await addChart('same', OFFICIAL, { id: 'title-same', ccliNumber: null })
      await linkSong(db, 'title-same', 'ccli-1')
      expect(await textOf('same')).to.equal(OFFICIAL)
    })

    it('skips a song with no chart', async () => {
      await add('official')
      await add('hand', { id: 'title-amazing', ccliNumber: null })
      await linkSong(db, 'title-amazing', 'ccli-1')
      expect((await get('hand')).variantOf).to.equal('official')
    })
  })
})
