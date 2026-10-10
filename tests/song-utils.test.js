import { expect } from '@open-wc/testing'
import { getCurrentDB } from '../src/js/db.ts'
import {
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
} from '../src/js/song-utils.js'
import { suppressConsoleLogs } from './test-helpers.js'

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
    expect((await db.getSong(song.uuid)).title).to.equal(title)
    expect((await db.getChordPro(song.chordproFileId)).content).to.contain('[G]Amazing')
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
    let error = null
    try {
      await createSong(chart(title))
    } catch (caught) {
      error = caught
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

    expect((await findExistingSong(ccli, 'Some other title')).uuid).to.equal(song.uuid)
    expect((await findExistingSong(null, `${title.toUpperCase()}!`)).uuid).to.equal(song.uuid)
    expect(await findExistingSong(null, unique('Nothing like it'))).to.equal(null)
  })

  it('prefers the default variant', async () => {
    const title = unique('Variants')
    const original = await createSong(chart(title))
    await createVariant(original.uuid, 'Acoustic', chart(title, { key: 'A' }))
    expect((await findExistingSong(null, title)).uuid).to.equal(original.uuid)
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

  it('says which song is missing', async () => {
    let error = null
    try {
      await getSongWithContent('no-such-song')
    } catch (caught) {
      error = caught
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
    expect((await getDefaultVariant(original.id)).uuid).to.equal(original.uuid)

    await setDefaultVariant(variant.uuid)
    expect((await getDefaultVariant(original.id)).uuid).to.equal(variant.uuid)
    expect((await getSongById(original.id)).uuid).to.equal(variant.uuid)
    const db = await getCurrentDB()
    expect((await db.getSong(original.uuid)).isDefault).to.equal(false)
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
    const setlist = songDate => ({
      id: crypto.randomUUID(),
      date: songDate,
      owner: `Leader ${songDate}`,
      songs: [{ songId: song.id, key: 'C' }],
    })
    await db.saveSetlist(setlist('2026-01-04'))
    await db.saveSetlist(setlist('2026-03-01'))

    const withUsage = (await getLibrarySongs(db, { withLastUsage: true })).find(
      entry => entry.id === song.id
    )
    expect(withUsage.lastUsageInfo).to.deep.equal({
      date: '2026-03-01',
      leader: 'Leader 2026-03-01',
      key: 'C',
    })

    const without = (await getLibrarySongs(db)).find(entry => entry.id === song.id)
    expect(without.lastUsageInfo).to.equal(undefined)
  })

  it('has no usage for a song never played', async () => {
    const song = await createSong(chart(unique('Never played')))
    const db = await getCurrentDB()
    const entry = (await getLibrarySongs(db, { withLastUsage: true })).find(
      candidate => candidate.id === song.id
    )
    expect(entry.lastUsageInfo).to.equal(undefined)
  })
})
