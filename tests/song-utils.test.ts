import { expect } from '@open-wc/testing'
import { getCurrentDB } from '../src/js/db.ts'
import {
  addChart,
  chartIdentity,
  createSong,
  createVariant,
  findExistingSong,
  formatArtistNames,
  getDefaultVariant,
  getLibrarySongs,
  getSongById,
  getSongVariants,
  getSongWithContent,
  hashText,
  importAsOriginal,
  importAsVariant,
  overwriteSong,
  replaceSong,
  setDefaultVariant,
  setSongRange,
  songOfEntry,
  versionForEntry,
} from '../src/js/song-utils.ts'
import { makeEntry, makeSetlist, makeSong } from './builders.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

/** A title no other test uses, as they share this test browser's database */
const unique = name => `${name} ${crypto.randomUUID().slice(0, 8)}`
const chart = (title, { key = 'G', extra = '', body = '[G]Amazing [C]grace' } = {}) =>
  `{title: ${title}}\n{key: ${key}}\n${extra}\n${body}`

describe('createSong', () => {
  it('stores the chart, and the song with fields from it, as the default variant', async () => {
    const title = unique('Created')
    const song = await createSong(chart(title, { extra: '{tempo: 72}\n{time: 3/4}' }))
    expect(song.title).to.equal(title)
    expect(song.isDefault).to.equal(true)
    expect(song.key).to.equal('G')
    expect(song.tempo).to.equal(72)

    const db = await getCurrentDB()
    expect(must(await db.getSong(song.uuid)).title).to.equal(title)
    expect(must(await db.getChordPro(song.chordproFileId)).content).to.contain('[G]Amazing')
  })

  it('identifies a song by its CCLI number when it has one, otherwise by its title', async () => {
    const ccli = String(Math.floor(Math.random() * 1e9))
    const withCcli = await createSong(chart(unique('With CCLI'), { extra: `{ccli: ${ccli}}` }))
    expect(withCcli.id).to.equal(`ccli-${ccli}`)

    const title = unique('Title Only')
    const withoutCcli = await createSong(chart(title))
    expect(withoutCcli.id).to.match(/^title-/)
    expect(withoutCcli.titleNormalized).to.equal(title.toLowerCase().replace(/\s+/g, ''))
  })

  it("uses the given title when the chart hasn't one", async () => {
    const title = unique('From options')
    const song = await createSong('[C]No title here', { title })
    expect(song.title).to.equal(title)
  })

  it('refuses a song already in the library, unless asked for a new one', async () => {
    const title = unique('Twice')
    await createSong(chart(title))
    let error: Error | null = null
    try {
      await createSong(chart(title))
    } catch (caught) {
      error = caught as Error
    }
    expect(error?.message).to.contain('Song already exists')

    const second = await createSong(chart(title), { forceNew: true })
    expect(second.isDefault).to.equal(false)
  })
})

describe('findExistingSong', () => {
  it('finds a song by CCLI number, or else by title ignoring case and punctuation', async () => {
    const ccli = String(Math.floor(Math.random() * 1e9))
    const title = unique('Findable')
    const song = await createSong(chart(title, { extra: `{ccli: ${ccli}}` }))

    expect(must(await findExistingSong(ccli, 'Some other title')).uuid).to.equal(song.uuid)
    expect(must(await findExistingSong(null, `${title.toUpperCase()}!`)).uuid).to.equal(song.uuid)
    expect(await findExistingSong(null, unique('Nothing like it'))).to.equal(null)
  })

  it('prefers the default variant', async () => {
    const title = unique('Variants')
    const original = await createSong(chart(title))
    await createVariant(original.uuid, 'Acoustic', chart(title, { key: 'A' }))
    expect(must(await findExistingSong(null, title)).uuid).to.equal(original.uuid)
  })
})

describe('getSongWithContent', () => {
  it('gives the song with its chart parsed, and metadata from the chart', async () => {
    const title = unique('With content')
    const song = await createSong(chart(title, { key: 'D', extra: '{tempo: 90}' }))
    const full = await getSongWithContent(song.uuid)
    expect(full.title).to.equal(title)
    expect(full.metadata.key).to.equal('D')
    expect(full.parsed.sections[0].lines[0].segments[0].chord).to.equal('G')
    expect(full.chordpro).to.contain('[G]Amazing')
  })

  it("gives the record's key and tempo at the top level", async () => {
    const song = await createSong(chart(unique('Top level'), { key: 'D', extra: '{tempo: 90}' }))
    const full = await getSongWithContent(song.uuid)
    expect(full.key).to.equal('D')
    expect(full.originalKey).to.equal('D')
    expect(full.tempo).to.equal(90)
    expect(full.originalTempo).to.equal(90)
  })

  it("gives the chart's CCLI number and trailer in the metadata", async () => {
    const trailer = 'CCLI Song # 7654321\nA. Writer\n© 2020 A Publisher'
    const song = await createSong(chart(unique('With trailer'), { body: `[G]Amazing\n${trailer}` }))
    const full = await getSongWithContent(song.uuid)
    expect(full.metadata.ccliSongNumber).to.equal('7654321')
    expect(full.metadata.ccliTrailer).to.equal(trailer)

    const directive = await createSong(
      chart(unique('With directive'), { extra: '{ccli: 1234567}' })
    )
    expect((await getSongWithContent(directive.uuid)).metadata.ccli).to.equal('1234567')
  })

  it("gives the chart's copyright in the metadata", async () => {
    const song = await createSong(
      chart(unique('Copyrighted'), { extra: '{copyright: Words PD. Chords © 2026 A. Person}' })
    )
    expect((await getSongWithContent(song.uuid)).metadata.copyright).to.equal(
      'Words PD. Chords © 2026 A. Person'
    )

    const plain = await createSong(chart(unique('Uncredited')))
    expect((await getSongWithContent(plain.uuid)).metadata.copyright).to.equal(undefined)
  })

  it('says which song is missing', async () => {
    let error: Error | null = null
    try {
      await getSongWithContent('no-such-song')
    } catch (caught) {
      error = caught as Error
    }
    expect(error?.message).to.equal('Song not found: no-such-song')
  })
})

describe('overwriteSong', () => {
  it("replaces the chart, and the song's fields and hash, keeping its identity", async () => {
    const title = unique('Overwritten')
    const song = await createSong(chart(title, { key: 'G' }))
    await getSongWithContent(song.uuid) // parse it, so the parse cache holds the old chart

    const updated = await overwriteSong(song.uuid, chart(title, { key: 'A', body: '[A]New words' }))
    expect(updated.uuid).to.equal(song.uuid)
    expect(updated.key).to.equal('A')
    expect(updated.contentHash).to.not.equal(song.contentHash)

    // The parse cache was cleared, so the new chart shows
    const full = await getSongWithContent(song.uuid)
    expect(full.chordpro).to.contain('[A]New words')
    expect(full.parsed.sections[0].lines[0].segments[0].chord).to.equal('A')
  })
})

describe('setSongRange', () => {
  const D4_TO_E5 = { low: 62, high: 76 }

  it('puts the range in the chart, and changes the hash and date for sync to see', async () => {
    const song = await createSong(chart(unique('Ranged')))
    await getSongWithContent(song.uuid) // (parsed, so the parse cache holds the chart without it)

    const updated = await setSongRange(song.uuid, D4_TO_E5)
    expect(updated.uuid).to.equal(song.uuid)
    expect(updated.contentHash).to.not.equal(song.contentHash)
    expect(updated.modifiedDate >= song.modifiedDate).to.equal(true)

    const full = await getSongWithContent(song.uuid)
    expect(full.chordpro).to.contain('{key: G}\n{x_chordless_range: D4-E5}')
    // (the parse cache was cleared: the chart shows the range)
    expect(full.parsed.metadata.x_chordless_range).to.equal('D4-E5')
  })

  it('changes a range already there where it stands, and takes it out with null', async () => {
    const song = await createSong(chart(unique('Changed')))
    await setSongRange(song.uuid, D4_TO_E5)
    await setSongRange(song.uuid, { low: 64, high: 77 })
    const changed = await getSongWithContent(song.uuid)
    expect(changed.chordpro.match(/x_chordless_range/g)).to.have.length(1)
    expect(changed.parsed.metadata.x_chordless_range).to.equal('E4-F5')

    const removed = await setSongRange(song.uuid, null)
    const after = await getSongWithContent(song.uuid)
    expect(after.chordpro).to.not.contain('x_chordless_range')
    expect(removed.contentHash).to.equal(hashText(after.chordpro))
  })

  it('does not touch the key or tempo the song was saved with: only the chart changes', async () => {
    const song = await createSong(chart(unique('Kept key'), { extra: '{tempo: 72}\n' }))
    const db = await getCurrentDB()
    // (a key and a tempo the person chose for the song, which the chart does not say)
    await db.saveSong({ ...must(await db.getSong(song.uuid)), key: 'A', tempo: 90 })
    await setSongRange(song.uuid, D4_TO_E5)
    const after = must(await db.getSong(song.uuid))
    expect(after.key).to.equal('A')
    expect(after.tempo).to.equal(90)
    expect(after.originalKey).to.equal('G')
  })

  it('does nothing when the chart would be the same', async () => {
    const song = await createSong(chart(unique('Same')))
    await setSongRange(song.uuid, D4_TO_E5)
    const again = await setSongRange(song.uuid, D4_TO_E5)
    const once = must(await (await getCurrentDB()).getSong(song.uuid))
    expect(again.contentHash).to.equal(once.contentHash)
    expect(again.modifiedDate).to.equal(once.modifiedDate)
    // (and there is nothing to take out of a chart with none)
    const bare = await createSong(chart(unique('Bare')))
    expect((await setSongRange(bare.uuid, null)).contentHash).to.equal(bare.contentHash)
  })

  it('gives a chart with no key the record’s, which the range is in', async () => {
    const title = unique('Keyless')
    const song = await createSong(`{title: ${title}}\n\n[G]No key line`)
    const db = await getCurrentDB()
    await db.saveSong({ ...must(await db.getSong(song.uuid)), key: 'D' })
    await setSongRange(song.uuid, D4_TO_E5)
    const full = await getSongWithContent(song.uuid)
    expect(full.chordpro).to.contain('{key: D}\n{x_chordless_range: D4-E5}')
  })

  it('says so when there is no key at all to write it in, or no song, or no chart', async () => {
    const song = await createSong(`{title: ${unique('No key anywhere')}}\n\n[G]Words`)
    let thrown = ''
    try {
      await setSongRange(song.uuid, D4_TO_E5)
    } catch (error) {
      thrown = (error as Error).message
    }
    expect(thrown).to.contain('no key')
    // (it can still be taken out, or there is nothing to take out)
    await setSongRange(song.uuid, null)

    for (const [uuid, message] of [['nobody', 'Song not found']] as const) {
      let error = ''
      try {
        await setSongRange(uuid, null)
      } catch (caught) {
        error = (caught as Error).message
      }
      expect(error).to.contain(message)
    }

    const db = await getCurrentDB()
    const orphan = makeSong({ chordproFileId: 'chordpro-not-there', key: 'G' })
    await db.saveSong(orphan)
    let missing = ''
    try {
      await setSongRange(orphan.uuid, D4_TO_E5)
    } catch (caught) {
      missing = (caught as Error).message
    }
    expect(missing).to.contain('chart of the song is not there')
    // (the test browser's database is shared: the song with no chart is not left in it)
    await db.deleteSong(orphan.uuid, { remember: false })
  })
})

describe('variants', () => {
  it('a variant shares the song, but is not its default until made so', async () => {
    const title = unique('Two versions')
    const original = await createSong(chart(title))
    const variant = await createVariant(original.uuid, 'Capo 2', chart(title, { key: 'E' }))
    expect(variant.id).to.equal(original.id)
    expect(variant.variantLabel).to.equal('Capo 2')
    expect(variant.isDefault).to.equal(false)

    const uuids = (await getSongVariants(original.id)).map(song => song.uuid)
    expect(uuids).to.have.members([original.uuid, variant.uuid])
    expect(must(await getDefaultVariant(original.id)).uuid).to.equal(original.uuid)

    await setDefaultVariant(variant.uuid)
    expect(must(await getDefaultVariant(original.id)).uuid).to.equal(variant.uuid)
    expect((await getSongById(original.id)).uuid).to.equal(variant.uuid)
    const db = await getCurrentDB()
    expect(must(await db.getSong(original.uuid)).isDefault).to.equal(false)
  })
})

describe('formatArtistNames', () => {
  it('splits on commas, semicolons and pipes, dropping "Words by" and "Music by"', () => {
    expect(
      formatArtistNames('Words by John Newton; Music by Edwin Excell | Chris Tomlin, ')
    ).to.deep.equal(['John Newton', 'Edwin Excell', 'Chris Tomlin'])
    expect(formatArtistNames('Music: Someone')).to.deep.equal(['Someone'])
    expect(formatArtistNames('')).to.deep.equal([])
  })
})

describe('hashText', () => {
  it('gives the same hash for the same text, and another for different text', () => {
    expect(hashText('[G]Amazing grace')).to.equal(hashText('[G]Amazing grace'))
    expect(hashText('[G]Amazing grace')).to.not.equal(hashText('[A]Amazing grace'))
    expect(hashText('x')).to.match(/^hash-[0-9a-f]+$/)
  })
})

describe('getLibrarySongs', () => {
  it('gives the songs by title, whatever order they were added in', async () => {
    const stamp = crypto.randomUUID().slice(0, 8)
    await createSong(chart(`Zeta ${stamp}`))
    await createSong(chart(`alpha ${stamp}`))
    await createSong(chart(`Mu ${stamp}`))
    const db = await getCurrentDB()
    const titles = (await getLibrarySongs(db))
      .map(song => song.title)
      .filter(t => t.endsWith(stamp))
    expect(titles).to.deep.equal([`alpha ${stamp}`, `Mu ${stamp}`, `Zeta ${stamp}`])
  })

  it('has one entry for a song with several variants', async () => {
    const title = unique('Has variants')
    const song = await createSong(chart(title))
    await createVariant(song.uuid, 'Acoustic', chart(title, { key: 'A' }))
    const db = await getCurrentDB()
    const matching = (await getLibrarySongs(db)).filter(entry => entry.title === title)
    expect(matching).to.have.length(1)
    expect(matching[0].id).to.equal(song.id)
  })

  it('lists every variant of a song, together, the default first then the oldest, when asked, each with how many there are', async () => {
    const title = unique('Every variant')
    const song = await createSong(chart(title))
    const newer = await createVariant(song.uuid, 'Newer', chart(title, { key: 'A' }))
    const older = await createVariant(song.uuid, 'Older', chart(title, { key: 'B' }))
    const db = await getCurrentDB()
    // (the order they were made in is not what is under test)
    await db.saveSong({ ...must(await db.getSong(newer.uuid)), importDate: '2026-02-01T00:00:00Z' })
    await db.saveSong({ ...must(await db.getSong(older.uuid)), importDate: '2026-01-01T00:00:00Z' })
    const matching = (await getLibrarySongs(db, { allVariants: true })).filter(
      entry => entry.title === title
    )
    expect(matching.map(entry => [entry.variantLabel, entry.variantCount])).to.deep.equal([
      ['Original', 3],
      ['Older', 3],
      ['Newer', 3],
    ])
    // (and the count is not given when only the defaults are listed)
    const defaults = (await getLibrarySongs(db)).filter(entry => entry.title === title)
    expect(defaults[0].variantCount).to.equal(undefined)
  })

  it('says when and by whom a song was last played, only when asked', async () => {
    const title = unique('Last played')
    const song = await createSong(chart(title))
    const db = await getCurrentDB()
    const setlist = (songDate: string) =>
      makeSetlist({
        id: crypto.randomUUID(),
        date: songDate,
        leaderId: `leader-${songDate}`,
        songs: [makeEntry({ songId: song.id, key: 'C' })],
      })
    await db.saveSetlist(setlist('2026-01-04'))
    await db.saveSetlist(setlist('2026-03-01'))
    await db.savePeople(
      ['2026-01-04', '2026-03-01'].map(songDate => ({
        id: `leader-${songDate}`,
        name: `Leader ${songDate}`,
        emails: [],
        modifiedDate: new Date().toISOString(),
      }))
    )

    const withUsage = must(
      (await getLibrarySongs(db, { withLastUsage: true })).find(entry => entry.id === song.id)
    )
    expect(withUsage.lastUsageInfo).to.deep.equal({
      date: '2026-03-01',
      leader: 'Leader 2026-03-01',
      key: 'C',
    })

    const without = must((await getLibrarySongs(db)).find(entry => entry.id === song.id))
    expect(without.lastUsageInfo).to.equal(undefined)
  })

  it('has no usage for a song never played', async () => {
    const song = await createSong(chart(unique('Never played')))
    const db = await getCurrentDB()
    const entry = must(
      (await getLibrarySongs(db, { withLastUsage: true })).find(
        candidate => candidate.id === song.id
      )
    )
    expect(entry.lastUsageInfo).to.equal(undefined)
  })
})

describe('which version of a song a setlist entry plays', () => {
  const record = (uuid: string, isDefault: boolean) => ({ uuid, isDefault }) as never
  const entry = (songUuid: string) => makeEntry({ songId: 'title-x', songUuid })

  it('is the one it names, else the default, else the first', () => {
    const versions = [record('old', false), record('new', true), record('other', false)]
    expect(versionForEntry(entry('other'), versions)?.uuid).to.equal('other')
    expect(versionForEntry(entry('gone'), versions)?.uuid).to.equal('new')
    expect(versionForEntry(entry('gone'), [record('a', false), record('b', false)])?.uuid).to.equal(
      'a'
    )
    expect(versionForEntry(entry('gone'), [])).to.equal(undefined)
  })

  describe('as the chart it plays', () => {
    async function twoVersions() {
      const title = unique('Two versions')
      const original = await createSong(chart(title, { key: 'D', body: '[D]Original chart' }))
      const newday = await createVariant(
        original.uuid,
        'Newday',
        chart(title, { key: 'A', body: '[A]Newday chart' })
      )
      return { original, newday }
    }

    it('is the version the entry names, though it is not the default', async () => {
      const { original, newday } = await twoVersions()
      const played = await songOfEntry(makeEntry({ songId: original.id, songUuid: newday.uuid }))
      expect(played.uuid).to.equal(newday.uuid)
      expect(played.chordpro).to.contain('[A]Newday chart')
      const other = await songOfEntry(makeEntry({ songId: original.id, songUuid: original.uuid }))
      expect(other.chordpro).to.contain('[D]Original chart')
    })

    it('is the default when the version it names is not in the library, or is another song’s', async () => {
      const { original } = await twoVersions()
      const stranger = await createSong(chart(unique('Another song')))
      for (const songUuid of ['not-here', stranger.uuid]) {
        const played = await songOfEntry(makeEntry({ songId: original.id, songUuid }))
        expect(played.uuid, songUuid).to.equal(original.uuid)
      }
    })

    it('says so when there is no such song', async () => {
      let thrown = ''
      try {
        await songOfEntry(makeEntry({ songId: 'title-nobody', songUuid: 'nobody' }))
      } catch (error) {
        thrown = (error as Error).message
      }
      expect(thrown).to.contain('Song not found: title-nobody')
    })
  })

  describe('and when each version was last played', () => {
    const played = (id: string, date: string, entry: ReturnType<typeof makeEntry>) =>
      makeSetlist({ id, date, songs: [entry], leaderId: 'someone' })

    it('is not the date of another version: a version never played says so', async () => {
      const title = unique('Newday version')
      const original = await createSong(chart(title, { key: 'D' }))
      const newday = await createVariant(
        original.uuid,
        'Newday version',
        chart(title, { key: 'A' })
      )
      const db = await getCurrentDB()
      await db.saveSetlist(
        played(
          crypto.randomUUID(),
          '2026-10-12',
          makeEntry({ songId: original.id, songUuid: newday.uuid, key: 'A' })
        )
      )

      const cards = (await getLibrarySongs(db, { withLastUsage: true, allVariants: true })).filter(
        card => card.id === original.id
      )
      const [originalCard, newdayCard] = [original, newday].map(version =>
        must(cards.find(card => card.uuid === version.uuid))
      )
      // the original has never been played, and the card can say so, since the song has
      expect(originalCard.lastUsageInfo).to.equal(undefined)
      expect(originalCard.playedInOtherVersion).to.equal(true)
      expect(newdayCard.lastUsageInfo).to.include({ date: '2026-10-12', key: 'A' })
      expect(newdayCard.playedInOtherVersion).to.equal(undefined)
    })

    it('is when any version was, for the one card that stands for the song', async () => {
      const title = unique('One card')
      const original = await createSong(chart(title))
      const variant = await createVariant(original.uuid, 'Other', chart(title, { key: 'A' }))
      const db = await getCurrentDB()
      await db.saveSetlist(
        played(
          crypto.randomUUID(),
          '2026-09-01',
          makeEntry({ songId: original.id, songUuid: variant.uuid })
        )
      )
      const [card] = (await getLibrarySongs(db, { withLastUsage: true })).filter(
        each => each.id === original.id
      )
      expect(card.lastUsageInfo?.date).to.equal('2026-09-01')
      expect(card.playedInOtherVersion).to.equal(undefined)
    })

    it('counts an entry whose version is not here for the default, which it plays', async () => {
      const title = unique('Plays the default')
      const original = await createSong(chart(title))
      await createVariant(original.uuid, 'Other', chart(title, { key: 'A' }))
      const db = await getCurrentDB()
      await db.saveSetlist(
        played(
          crypto.randomUUID(),
          '2026-08-01',
          makeEntry({ songId: original.id, songUuid: 'not-here' })
        )
      )
      const cards = (await getLibrarySongs(db, { withLastUsage: true, allVariants: true })).filter(
        card => card.id === original.id
      )
      expect(must(cards.find(card => card.uuid === original.uuid)).lastUsageInfo?.date).to.equal(
        '2026-08-01'
      )
      expect(must(cards.find(card => card.uuid !== original.uuid)).lastUsageInfo).to.equal(
        undefined
      )
    })

    it('is nothing, and nothing is said, for a song with no version played', async () => {
      const title = unique('No version played')
      const original = await createSong(chart(title))
      await createVariant(original.uuid, 'Other', chart(title, { key: 'A' }))
      const db = await getCurrentDB()
      const cards = (await getLibrarySongs(db, { withLastUsage: true, allVariants: true })).filter(
        card => card.id === original.id
      )
      for (const card of cards) {
        expect(card.lastUsageInfo).to.equal(undefined)
        expect(card.playedInOtherVersion).to.equal(undefined)
      }
    })
  })
})

describe('songs that are not as they should be', () => {
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise
    } catch (error) {
      return (error as Error).message
    }
    return null
  }

  it('says so when a song is not there, or its chart is gone', async () => {
    expect(await failure(getSongWithContent('no-such-song'))).to.equal(
      'Song not found: no-such-song'
    )

    const db = await getCurrentDB()
    const lost = makeSong({ uuid: unique('lost'), chordproFileId: 'chordpro-gone' })
    await db.saveSong(lost)
    expect(await failure(getSongWithContent(lost.uuid))).to.equal(
      'ChordPro content not found: chordpro-gone'
    )
  })

  it('leaves out of the library a song whose chart is gone, and says so', async () => {
    const db = await getCurrentDB()
    const lost = makeSong({
      uuid: unique('lost'),
      id: unique('title-lost'),
      chordproFileId: 'chordpro-gone',
    })
    await db.saveSong(lost)
    const realError = console.error
    const errors: unknown[][] = []
    console.error = (...args) => errors.push(args)
    try {
      const songs = await getLibrarySongs(db)
      expect(songs.some(song => song.uuid === lost.uuid)).to.equal(false)
    } finally {
      console.error = realError
    }
    expect(errors.some(args => String(args[0]).includes(lost.uuid))).to.equal(true)
  })

  it('finds the first of the songs of a title when none is the default', async () => {
    const db = await getCurrentDB()
    const title = unique('No default')
    const normalized = title.toLowerCase().replace(/[^a-z0-9]/g, '')
    const ccli = String(Math.floor(Math.random() * 1e9))
    for (const label of ['One', 'Two']) {
      await db.saveSong(
        makeSong({
          uuid: unique(label),
          id: unique('title-nodefault'),
          title,
          titleNormalized: normalized,
          ccliNumber: ccli,
          isDefault: false,
          chordproFileId: 'chordpro-x',
        })
      )
    }
    expect(must(await findExistingSong(ccli, null)).isDefault).to.equal(false)
    expect(must(await findExistingSong(null, title)).isDefault).to.equal(false)
  })

  it('titles a chart that has no title by the title it is given, else Untitled', async () => {
    const body = '{key: G}\n[G]Words with no title'
    expect((await createSong(`${body} ${unique('a')}`, { title: 'Given title' })).title).to.equal(
      'Given title'
    )
    expect((await createSong(`${body} ${unique('b')}`)).title).to.equal('Untitled')

    const db = await getCurrentDB()
    expect((await addChart(db, `${body} ${unique('c')}`, ADD)).title).to.equal('Untitled')
    expect(
      (await addChart(db, `${body} ${unique('d')}`, { ...ADD, title: 'Fallback' })).title
    ).to.equal('Fallback')
  })

  it('says so when asked to change, vary or make default a song that is not there', async () => {
    expect(await failure(overwriteSong('nobody', chart('x')))).to.equal('Song not found: nobody')
    expect(await failure(createVariant('nobody', 'Label', chart('x')))).to.equal(
      'Source song not found: nobody'
    )
    expect(await failure(setDefaultVariant('nobody'))).to.equal('Song not found: nobody')
  })

  it('keeps no more than a hundred parsed charts, letting the oldest go', async function () {
    this.timeout(10000) // (a hundred and three songs saved and read)
    const songs: Awaited<ReturnType<typeof createSong>>[] = []
    for (let i = 0; i < 103; i++) songs.push(await createSong(chart(unique(`Cached ${i}`))))
    for (const song of songs) await getSongWithContent(song.uuid)
    // The first has gone from the cache, and is parsed again without trouble
    expect((await getSongWithContent(songs[0].uuid)).title).to.equal(songs[0].title)
  })
})

const ADD = { variantLabel: 'Test', importSource: 'test', makeDefault: 'first' } as const

describe('who a chart is', () => {
  it('is its CCLI number, else its title, whatever the fallback says', () => {
    expect(chartIdentity({ ccli: '123', title: 'Grace' }, { title: 'Other' })).to.include({
      id: 'ccli-123',
      ccliNumber: '123',
      title: 'Grace',
    })
    expect(chartIdentity({ title: 'Amazing Grace' }, { ccliNumber: '9' })).to.include({
      id: 'ccli-9',
      ccliNumber: '9',
    })
    expect(chartIdentity({ title: 'Amazing Grace' }).id).to.equal('title-amazinggrace')
  })

  it('takes the title, and the id, from the fallback for what the chart lacks', () => {
    expect(chartIdentity({}, { title: 'From Drive' })).to.include({
      id: 'title-fromdrive',
      title: 'From Drive',
    })
    expect(chartIdentity({}, { title: 'From Drive', id: 'kept-id' }).id).to.equal('kept-id')
  })

  it('is a new id for each chart with no title at all: untitled songs are not one song', () => {
    const first = chartIdentity({})
    expect(first.title).to.equal('Untitled')
    expect(first.id).to.match(/^song-/)
    expect(chartIdentity({}).id).to.not.equal(first.id)
  })
})

describe('an incoming chart of a song the library has', () => {
  let ccli = 7000000
  const official = (title, body = '[A]Amazing [D]grace') =>
    `{title: ${title}}\n{key: A}\n{ccli: ${ccli}}\n${body}`
  const incoming = { importSource: 'songselect', importUser: 'Jo' }

  it('replaces the chart and takes the new CCLI number, source, importer and date', async () => {
    ccli++
    const title = unique('Replaced')
    const old = await createSong(chart(title), { importSource: 'Simon' } as never)
    const db = await getCurrentDB()
    const other = await createVariant(old.uuid, 'Simpler', chart(title, { body: '[G]Other' }))
    const setlist = makeSetlist({ songs: [makeEntry({ songUuid: old.uuid, songId: old.id })] })
    await db.saveSetlist(setlist)

    const replaced = await replaceSong(old.uuid, official(title), incoming)

    expect(replaced.uuid).to.equal(old.uuid)
    expect(replaced.id).to.equal(`ccli-${ccli}`)
    expect(replaced.ccliNumber).to.equal(String(ccli))
    expect(replaced.importSource).to.equal('songselect')
    expect(replaced.importUser).to.equal('Jo')
    expect(replaced.importDate).to.not.equal(old.importDate)
    expect(must(await db.getChordPro(replaced.chordproFileId)).content).to.contain('[A]Amazing')
    expect(must(await db.getSong(other.uuid)).id).to.equal(`ccli-${ccli}`)
    expect(must(await db.getSetlist(setlist.id)).songs[0]).to.include({
      songUuid: old.uuid,
      songId: `ccli-${ccli}`,
    })
  })

  describe('the key and tempo it is in', () => {
    const NOW_ISO = '2026-01-01T00:00:00.000Z'
    const setlistOf = (id: string, entries: ReturnType<typeof makeEntry>[]) =>
      makeSetlist({ id, songs: entries, modifiedDate: NOW_ISO })
    const entryOf = async (setlistId: string, index = 0) =>
      must((await (await getCurrentDB()).getSetlist(setlistId))?.songs[index])

    /** A song in G, 80, that someone has put in A, 90 (as the library shows it), and the chart that replaces it */
    async function songInA(titlePrefix: string, extra = '') {
      const title = unique(titlePrefix)
      const song = await createSong(chart(title, { extra: `{tempo: 80}\n${extra}` }))
      const db = await getCurrentDB()
      await db.saveSong({ ...must(await db.getSong(song.uuid)), key: 'A', tempo: 90 })
      return { title, song, db }
    }
    const newChart = (title: string, key = 'E', tempo = 70) =>
      `{title: ${title}}\n{key: ${key}}\n{tempo: ${tempo}}\n{ccli: ${ccli}}\n[${key}]Amazing [A]grace`

    it('is the new chart’s: the song is now in the key SongSelect has it, with that original key and tempo', async () => {
      ccli++
      const { title, song, db } = await songInA('Takes the new key')
      const replaced = await replaceSong(song.uuid, newChart(title), incoming)
      expect(replaced.key).to.equal('E')
      expect(replaced.tempo).to.equal(70)
      expect(replaced.originalKey).to.equal('E')
      expect(replaced.originalTempo).to.equal(70)
      expect(must(await db.getChordPro(replaced.chordproFileId)).content).to.contain('{key: E}')
    })

    it('writes the key and tempo the setlists showed into their entries, so no setlist changes', async () => {
      ccli++
      const { title, song, db } = await songInA('Pins setlists')
      await db.saveSetlist(
        setlistOf('pins-1', [
          makeEntry({ songUuid: song.uuid, songId: song.id }), // follows the song: A, 90
          makeEntry({ order: 1, songUuid: song.uuid, songId: song.id, key: 'C', tempo: 100 }),
          makeEntry({ order: 2, songUuid: 'other', songId: 'title-another-song' }),
        ])
      )
      await db.saveSetlist(
        setlistOf('pins-2', [makeEntry({ songUuid: song.uuid, songId: song.id })])
      )
      // (one that has none of the song: not saved at all)
      await db.saveSetlist(
        setlistOf('pins-none', [makeEntry({ songUuid: 'other', songId: 'title-another-song' })])
      )

      const replaced = await replaceSong(song.uuid, newChart(title), incoming)

      const followed = await entryOf('pins-1')
      expect(followed).to.include({ key: 'A', tempo: 90, songId: replaced.id })
      // (an entry with its own key and tempo keeps them, and another song's is left as it is)
      expect(await entryOf('pins-1', 1)).to.include({ key: 'C', tempo: 100 })
      expect(await entryOf('pins-1', 2)).to.include({ key: null, tempo: null })
      expect(await entryOf('pins-2')).to.include({ key: 'A', tempo: 90 })
      const untouched = must(await db.getSetlist('pins-none'))
      expect(untouched.modifiedDate).to.equal(NOW_ISO)
      expect(must(await db.getSetlist('pins-1')).modifiedDate).to.not.equal(NOW_ISO)
    })

    it('pins the key when only the key moves, and the tempo when only the tempo does', async () => {
      ccli++
      const { title, song, db } = await songInA('Only one moves')
      await db.saveSetlist(
        setlistOf('only-key', [makeEntry({ songUuid: song.uuid, songId: song.id })])
      )
      await replaceSong(song.uuid, newChart(title, 'E', 90), incoming)
      // (the new chart's tempo is the song's 90 already: only the key moved)
      expect(await entryOf('only-key')).to.include({ key: 'A', tempo: null })

      ccli++
      const other = await songInA('Only tempo')
      await other.db.saveSetlist(
        setlistOf('only-tempo', [makeEntry({ songUuid: other.song.uuid, songId: other.song.id })])
      )
      await replaceSong(other.song.uuid, newChart(other.title, 'A', 70), incoming)
      expect(await entryOf('only-tempo')).to.include({ key: null, tempo: 90 })
    })

    it('changes no setlist when the key and tempo do not move', async () => {
      ccli++
      const { title, song, db } = await songInA('Does not move', `{ccli: ${ccli}}\n`)
      await db.saveSetlist(
        setlistOf('no-move', [makeEntry({ songUuid: song.uuid, songId: song.id })])
      )
      await replaceSong(song.uuid, newChart(title, 'A', 90), incoming)
      const after = must(await db.getSetlist('no-move'))
      expect(after.modifiedDate).to.equal(NOW_ISO)
      expect(after.songs[0]).to.include({ key: null, tempo: null })
    })

    it('follows a song whose id changes with the new chart: the entry moves, and is pinned', async () => {
      ccli++
      const title = unique('Changes id')
      const old = await createSong(chart(title))
      const db = await getCurrentDB()
      expect(old.id).to.not.equal(`ccli-${ccli}`)
      await db.saveSetlist(setlistOf('new-id', [makeEntry({ songUuid: old.uuid, songId: old.id })]))
      const replaced = await replaceSong(old.uuid, newChart(title), incoming)
      expect(replaced.id).to.equal(`ccli-${ccli}`)
      expect(await entryOf('new-id')).to.include({ songId: `ccli-${ccli}`, key: 'G' })
    })

    it('pins a song that is its id’s only version, though it is not flagged the default', async () => {
      ccli++
      const title = unique('Lone version')
      const song = await createSong(chart(title))
      const db = await getCurrentDB()
      await db.saveSong({ ...must(await db.getSong(song.uuid)), isDefault: false })
      await db.saveSetlist(setlistOf('lone', [makeEntry({ songUuid: song.uuid, songId: song.id })]))
      await replaceSong(song.uuid, newChart(title), incoming)
      expect(await entryOf('lone')).to.include({ key: 'G' })
    })

    it('leaves the setlists alone when the version it replaces is not the one they show', async () => {
      ccli++
      const title = unique('Other version')
      const withCcli = `{ccli: ${ccli}}\n`
      const original = await createSong(chart(title, { extra: withCcli }))
      const variant = await createVariant(
        original.uuid,
        'Simpler',
        chart(title, { key: 'D', extra: withCcli })
      )
      const db = await getCurrentDB()
      await db.saveSetlist(
        setlistOf('shown', [makeEntry({ songUuid: original.uuid, songId: original.id })])
      )
      await replaceSong(variant.uuid, newChart(title), incoming)
      // (the setlist shows the original, which has not changed)
      expect(await entryOf('shown')).to.include({ key: null })
      expect(must(await db.getSetlist('shown')).modifiedDate).to.equal(NOW_ISO)
    })

    it('pins the entries that name a version that is replaced, and not those that name another', async () => {
      ccli++
      const title = unique('Names a version')
      const withCcli = `{ccli: ${ccli}}\n`
      const original = await createSong(chart(title, { key: 'G', extra: withCcli }))
      const variant = await createVariant(
        original.uuid,
        'Simpler',
        chart(title, { key: 'D', extra: withCcli })
      )
      const db = await getCurrentDB()
      await db.saveSetlist(
        setlistOf('names-version', [
          makeEntry({ songUuid: original.uuid, songId: original.id }), // plays the original: G
          makeEntry({ order: 1, songUuid: variant.uuid, songId: original.id }), // plays the variant: D
          makeEntry({ order: 2, songUuid: 'not-here', songId: original.id }), // plays the default: G
        ])
      )
      await replaceSong(variant.uuid, newChart(title, 'E', 70), incoming)
      // (only the entry that played the variant moves with it: it is pinned to the key it showed)
      expect((await entryOf('names-version', 0)).key).to.equal(null)
      expect((await entryOf('names-version', 1)).key).to.equal('D')
      expect((await entryOf('names-version', 2)).key).to.equal(null)

      await replaceSong(original.uuid, newChart(title, 'A', 70), incoming)
      // (now the default is replaced: the entry that played it, and the one that falls back to it)
      expect((await entryOf('names-version', 0)).key).to.equal('G')
      expect((await entryOf('names-version', 2)).key).to.equal('G')
      expect((await entryOf('names-version', 1)).key).to.equal('D')
    })

    it('writes nothing for a song that had no key to show', async () => {
      ccli++
      const title = unique('No key before')
      const song = await createSong(`{title: ${title}}\n\n[G]No key line`)
      const db = await getCurrentDB()
      await db.saveSong({ ...must(await db.getSong(song.uuid)), key: null, originalKey: null })
      await db.saveSetlist(
        setlistOf('no-key', [makeEntry({ songUuid: song.uuid, songId: song.id })])
      )
      await replaceSong(song.uuid, newChart(title), incoming)
      expect(await entryOf('no-key')).to.include({ key: null })
    })
  })

  it("imports as the original: the incoming chart is the default, the library's hangs from it, setlists keep theirs", async () => {
    ccli++
    const title = unique('Both')
    const old = await createSong(chart(title), {
      importSource: 'Simon',
      importUser: 'Simon',
    } as never)
    const db = await getCurrentDB()
    const setlist = makeSetlist({ songs: [makeEntry({ songUuid: old.uuid, songId: old.id })] })
    await db.saveSetlist(setlist)

    const { added, kept } = await importAsOriginal(old.uuid, official(title), incoming)

    expect(added.isDefault).to.equal(true)
    expect(added.id).to.equal(`ccli-${ccli}`)
    expect(added.importSource).to.equal('songselect')
    expect(added.importUser).to.equal('Jo')
    expect(kept.uuid).to.equal(old.uuid)
    expect(kept.isDefault).to.equal(false)
    expect(kept.variantOf).to.equal(added.uuid)
    expect(kept.variantLabel).to.equal('Alternate chords')
    expect(kept.id).to.equal(added.id)
    expect(kept.importDate).to.equal(old.importDate)
    expect(kept.metadataChangedAt).to.be.a('string')
    expect((await getSongVariants(added.id)).map(v => v.uuid).sort()).to.deep.equal(
      [added.uuid, old.uuid].sort()
    )
    expect(must(await db.getSetlist(setlist.id)).songs[0]).to.include({
      songUuid: old.uuid,
      songId: `ccli-${ccli}`,
    })
  })

  it('will not import the same chart as the original or a variant', async () => {
    ccli++
    const title = unique('Same')
    const text = official(title)
    const old = await createSong(text)
    let failure = ''
    await importAsOriginal(old.uuid, text, incoming).catch(error => {
      failure = error.message
    })
    expect(failure).to.contain('already has this chart')
    failure = ''
    await importAsVariant(old.uuid, text, incoming).catch(error => {
      failure = error.message
    })
    expect(failure).to.contain('already has this chart')
  })

  it('imports as a variant: the library keeps the default, the import hangs from it with its label', async () => {
    ccli++
    const title = unique('As variant')
    const old = await createSong(chart(title))
    const db = await getCurrentDB()
    const added = await importAsVariant(old.uuid, official(title), incoming, 'Official')
    expect(added.isDefault).to.equal(false)
    expect(added.variantOf).to.equal(old.uuid)
    expect(added.variantLabel).to.equal('Official')
    expect(added.importUser).to.equal('Jo')
    expect(added.id).to.equal(`ccli-${ccli}`)
    const kept = must(await db.getSong(old.uuid))
    expect(kept.isDefault).to.equal(true)
    expect(kept.id).to.equal(`ccli-${ccli}`)
    expect(kept.ccliNumber).to.equal(String(ccli))
  })

  it('does not lose the CCLI number when the incoming chart has none', async () => {
    ccli++
    const title = unique('Keeps ccli')
    const old = await createSong(official(title))
    const db = await getCurrentDB()
    const handMade = `{title: ${title}}\n{key: G}\n[G]Amazing [C]grace`
    const added = await importAsVariant(old.uuid, handMade, incoming)
    expect(added.id).to.equal(`ccli-${ccli}`)
    expect(added.ccliNumber).to.equal(String(ccli))
    expect(must(await db.getSong(old.uuid)).id).to.equal(`ccli-${ccli}`)
    const replaced = await replaceSong(
      old.uuid,
      `{title: ${title}}\n[D]Other words entirely`,
      incoming
    )
    expect(replaced.ccliNumber).to.equal(String(ccli))
  })
})
