import { expect } from '@open-wc/testing'
import { getCurrentDB } from '../src/js/db.ts'
import {
  addChart,
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
  overwriteSong,
  setDefaultVariant,
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

  it('says when and by whom a song was last played, only when asked', async () => {
    const title = unique('Last played')
    const song = await createSong(chart(title))
    const db = await getCurrentDB()
    const setlist = (songDate: string) =>
      makeSetlist({
        id: crypto.randomUUID(),
        date: songDate,
        owner: `Leader ${songDate}`,
        songs: [makeEntry({ songId: song.id, key: 'C' })],
      })
    await db.saveSetlist(setlist('2026-01-04'))
    await db.saveSetlist(setlist('2026-03-01'))

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

  it('keeps no more than a hundred parsed charts, letting the oldest go', async () => {
    const songs: Awaited<ReturnType<typeof createSong>>[] = []
    for (let i = 0; i < 103; i++) songs.push(await createSong(chart(unique(`Cached ${i}`))))
    for (const song of songs) await getSongWithContent(song.uuid)
    // The first has gone from the cache, and is parsed again without trouble
    expect((await getSongWithContent(songs[0].uuid)).title).to.equal(songs[0].title)
  })
})

const ADD = { variantLabel: 'Test', importSource: 'test', makeDefault: 'first' } as const
