import { expect, fixture, html } from '@open-wc/testing'
import { SongImportedEvent } from '../src/components/song-import.ts'
import type { SongRecord } from '../src/js/data-types.ts'
import { createSetlist, getCurrentDB, openSpace } from '../src/js/db.ts'
import { addChart, createSong } from '../src/js/song-utils.ts'
import {
  createSpace,
  deleteSpace,
  ensureCurrentSpace,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
import { makeEntry, makeSetlist } from './builders.ts'
import { must } from './must.ts'
import { A11Y, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

/**
 * The song-import page's own logic: reading files and pasted text, finding
 * songs already in the library, and the choices that follow. Uses this test
 * browser's real database, with a unique title per song so tests don't meet.
 */
describe('song-import', () => {
  const unique = name => `${name} ${crypto.randomUUID().slice(0, 8)}`
  const chart = (title, body = '[C]Hello') => `{title: ${title}}\n{key: C}\n\n${body}`
  const file = (name, content, type = '') => new File([content], name, { type })

  async function importer() {
    return fixture(html`<song-import></song-import>`)
  }

  const $ = (element, selector) => element.shadowRoot.querySelector(selector)
  const text = element => element.shadowRoot.textContent.replace(/\s+/g, ' ')

  /** Resolves with the url the importer goes to when it's done, staying here */
  function finished(element) {
    return new Promise(resolve => {
      element.addEventListener(
        SongImportedEvent.type,
        event => {
          event.preventDefault()
          resolve(event.url)
        },
        { once: true }
      )
    })
  }

  async function paste(element, chordproText) {
    $(element, 'textarea').value = chordproText
    $(element, '.paste .add').click()
    await waitFor(() => element._state === 'choices' || element._error)
    await element.updateComplete
  }

  /** Pick what to do with the duplicate, and do it */
  async function choose(element, pick: string, { apply = true } = {}) {
    $(element, `.pick-${pick}`).click()
    await element.updateComplete
    if (apply) $(element, '.apply').click()
  }

  async function songTitled(title) {
    const db = await getCurrentDB()
    return (await db.getAllSongs()).find(song => song.title === title)
  }

  it('offers files, pasting, and the SongSelect bookmarklet, and is accessible', async () => {
    const element: any = await importer()
    expect(text(element)).to.contain('Import ChordPro Files')
    expect(text(element)).to.contain('Paste ChordPro')
    expect(text(element)).to.contain('Import from SongSelect')
    await expect(element).to.be.accessible(A11Y)
  })

  it('shows a failed SongSelect download, and ignores messages from other sites', async () => {
    const element: any = await importer()
    const failed = { type: 'CHORDLESS_IMPORT_FAILED', data: { message: 'Download failed: 403' } }
    window.dispatchEvent(
      new MessageEvent('message', { origin: 'https://evil.example', data: failed })
    )
    await element.updateComplete
    expect($(element, '[role="alert"]')).to.equal(null)

    window.dispatchEvent(
      new MessageEvent('message', { origin: 'https://songselect.ccli.com', data: failed })
    )
    await element.updateComplete
    expect($(element, '[role="alert"]').textContent).to.contain('Download failed: 403')
  })

  it('says so when the pasted text is empty', async () => {
    const element: any = await importer()
    await paste(element, '   ')
    expect($(element, '[role="alert"]').textContent).to.contain('No songs to import')
  })

  it('saves pasted ChordPro to the library only, going to the song', async () => {
    const element: any = await importer()
    const title = unique('Pasted')
    await paste(element, chart(title))
    expect(text(element)).to.contain(title)

    const url = finished(element)
    $(element, '.library-only').click()
    const song = must(await songTitled(title))
    expect(await url).to.equal(`/songs/${song.uuid}`)
    expect(song.importSource).to.equal('paste')
  })

  it('imports several files, naming untitled ones after the file and skipping non-text', async () => {
    const element: any = await importer()
    const first = unique('First')
    const second = unique('Second')
    await element.importFiles([
      file('first.cho', chart(first)),
      file(`${second}.chordpro`, '[D]No title in the chart'),
      file('photo.png', 'not a song', 'image/png'),
    ])
    await element.updateComplete

    expect($(element, 'h2').textContent).to.contain('2 songs')
    expect($(element, '.songs').textContent).to.contain(first)
    expect($(element, '.songs').textContent).to.contain(second)
    expect(text(element)).to.contain('Not imported: photo.png: not a text file')
    expect(must(await songTitled(second)).importSource).to.equal('file')
  })

  it('adds a song already in the library to an existing setlist, keeping its chart', async () => {
    const title = unique('Existing')
    const existing = await createSong(chart(title, '[G]Original'))
    const db = await getCurrentDB()
    const setlist = createSetlist({ date: '2099-01-01', name: unique('Setlist') })
    await db.saveSetlist(setlist)

    const element: any = await importer()
    await paste(element, chart(title, '[A]Imported'))
    expect(text(element)).to.contain('already exists in your library')
    await choose(element, 'use-existing')
    await waitFor(() => $(element, '.choices'))

    $(element, 'select').value = setlist.id
    const url = finished(element)
    $(element, '.add-to-setlist .add').click()
    expect(await url).to.equal(`/setlist/${setlist.id}`)

    const saved = must(await db.getSetlist(setlist.id))
    expect(saved.songs.map(entry => entry.songUuid)).to.deep.equal([existing.uuid])
    expect(must(await db.getChordPro(existing.chordproFileId)).content).to.contain('[G]Original')
  })

  it('updates a song already in the library with the imported chart', async () => {
    const title = unique('Updated')
    const existing = await createSong(chart(title, '[G]Original'))

    const element: any = await importer()
    await paste(element, chart(title, '[A]Imported'))
    await choose(element, 'update')
    await waitFor(() => !text(element).includes('already exists in your library'))

    const db = await getCurrentDB()
    const song = must(await db.getSong(existing.uuid))
    expect(must(await db.getChordPro(song.chordproFileId)).content).to.contain('[A]Imported')
  })

  it('asks about each song already in the library among several, with Import all', async () => {
    const title = unique('Among several')
    const existing = await createSong(chart(title, '[G]Original'))

    const element: any = await importer()
    await element.importFiles([
      file('a.cho', chart(title, '[A]Updated')),
      file('b.cho', chart(unique('Brand new'))),
    ])
    await element.updateComplete
    expect(text(element)).to.contain('1 of these songs is already in your library')
    expect($(element, '.choices')).to.equal(null)
    await expect(element).to.be.accessible(A11Y)

    expect($(element, '.apply-all').disabled).to.equal(true)
    await choose(element, 'update', { apply: false })
    $(element, '.apply-all').click()
    await waitFor(() => $(element, '.choices'))
    expect($(element, '.songs').textContent).to.contain('updated')

    const db = await getCurrentDB()
    const song = must(await db.getSong(existing.uuid))
    expect(must(await db.getChordPro(song.chordproFileId)).content).to.contain('[A]Updated')
  })

  describe('where an imported chart is from', () => {
    /** A chart as SongSelect gives it: with its CCLI material at the foot */
    let ccliNumber = 8100000
    const fromSongSelect = (title: string, body = '[C]Hello') =>
      `${chart(title, body)}\n\nCCLI Song # ${++ccliNumber}\n© 2020 A Publisher\nFor use solely with the SongSelect® Terms of Use. All rights reserved. www.ccli.com\nCCLI License # 471102`
    const sourceOf = async (uuid: string) =>
      must(await (await getCurrentDB()).getSong(uuid)).importSource

    it('is SongSelect for a download chosen as a file, which carries SongSelect’s material', async () => {
      const element: any = await importer()
      await element.importFiles([file('a.cho', fromSongSelect(unique('Downloaded')))])
      expect(element._imports[0].source).to.equal('songselect')
      expect(await sourceOf(element._imports[0].song.uuid)).to.equal('songselect')
    })

    it('is a file when the chart has no such material', async () => {
      const element: any = await importer()
      await element.importFiles([file('a.cho', chart(unique('Typed')))])
      expect(await sourceOf(element._imports[0].song.uuid)).to.equal('file')
    })

    it('is SongSelect for text pasted from it, and pasted otherwise', async () => {
      const element: any = await importer()
      await paste(element, fromSongSelect(unique('Pasted download')))
      expect(await sourceOf(element._imports[0].song.uuid)).to.equal('songselect')
      const other: any = await importer()
      await paste(other, chart(unique('Pasted typing')))
      expect(await sourceOf(other._imports[0].song.uuid)).to.equal('paste')
    })

    it('catches the library up when the same chart comes again, and the library said a file', async () => {
      const title = unique('Said a file')
      const body = fromSongSelect(title)
      const song = await createSong(body, { importSource: 'file' } as never)
      const element: any = await importer()
      await element.importFiles([file('a.cho', body)])
      expect(element._imports[0].comparison.verdict).to.equal('identical')
      expect(element._imports[0].sourceSet).to.equal(true)
      expect(await sourceOf(song.uuid)).to.equal('songselect')
      expect(text(element)).to.contain(
        'nothing to import. Its source is now recorded as SongSelect.'
      )
    })

    it('says so in a list of songs too', async () => {
      const title = unique('In a list of files')
      const body = fromSongSelect(title)
      await createSong(body, { importSource: 'file' } as never)
      const element: any = await importer()
      await element.importFiles([
        file('a.cho', body),
        file('b.cho', fromSongSelect(unique('A new one'))),
      ])
      expect(text(element)).to.contain(
        'identical version already in library, now recorded as from SongSelect'
      )
    })

    it('leaves the library as it is when it already said SongSelect, or a person, or the chart is not SongSelect’s', async () => {
      for (const [recorded, chartText] of [
        ['songselect', fromSongSelect(unique('Already'))],
        ['Simon', fromSongSelect(unique('A person'))],
        ['file', chart(unique('Typed file'))],
      ] as const) {
        const song = await createSong(chartText, { importSource: recorded } as never)
        const element: any = await importer()
        await element.importFiles([file('a.cho', chartText)])
        expect(element._imports[0].comparison.verdict).to.equal('identical')
        expect(element._imports[0].sourceSet, recorded).to.equal(undefined)
        expect(await sourceOf(song.uuid), recorded).to.equal(recorded)
        expect(text(element)).to.not.contain('Its source is now')
      }
    })

    it('is SongSelect for the library song that an update replaces with a download', async () => {
      const title = unique('Updated from a file')
      const song = await createSong(chart(title, '[G]Old words'), { importSource: 'file' } as never)
      const element: any = await importer()
      await element.importFiles([file('a.cho', fromSongSelect(title, '[A]Imported'))])
      await choose(element, 'update')
      await waitFor(() => !text(element).includes('already exists in your library'))
      expect(await sourceOf(song.uuid)).to.equal('songselect')
    })
  })

  describe('several songs the library has', () => {
    /** The same song in a key, its chords moved with it */
    const inKey = (title: string, key: string, chords: [string, string]) =>
      `{title: ${title}}\n{key: ${key}}\n\n[${chords[0]}]Amazing [${chords[1]}]grace how [${chords[0]}]sweet`
    const sameWords = (title: string, chord: string) =>
      chart(title, `[${chord}]Amazing grace how sweet`)

    const chartOf = async (uuid: string) => {
      const db = await getCurrentDB()
      return must(await db.getChordPro(must(await db.getSong(uuid)).chordproFileId)).content
    }
    const picks = (element: any) => element._imports.map((item: any) => item.pick)
    const asked = (element: any) =>
      element._imports.filter((item: any) => item.isDuplicate && !item.choice && !item.auto)

    /** Three songs the library has, and a new chart of each: another key, other details, other chords */
    async function threeDuplicates() {
      const titles = [unique('Another key'), unique('Other details'), unique('Other chords')]
      const library = [
        await createSong(inKey(titles[0], 'C', ['C', 'F'])),
        await createSong(chart(titles[1], '[C]Same')),
        await createSong(sameWords(titles[2], 'G')),
      ]
      const element: any = await importer()
      await element.importFiles([
        file('a.cho', inKey(titles[0], 'D', ['D', 'G'])),
        file('b.cho', `{title: ${titles[1]}}\n{key: C}\n{tempo: 80}\n\n[C]Same`),
        file('c.cho', sameWords(titles[2], 'D')),
      ])
      await element.updateComplete
      return { element, library, titles }
    }

    it('updates the songs that are the same song with no question, and asks only about the rest', async () => {
      const { element, library } = await threeDuplicates()
      expect(element._imports.map((item: any) => item.comparison.verdict)).to.deep.equal([
        'other-key',
        'same-chart',
        'different-chords',
      ])
      expect(element._imports.map((item: any) => item.choice)).to.deep.equal([
        'update',
        'update',
        null,
      ])
      // (the other chords are not the library's: that is for the person to decide)
      expect(asked(element)).to.have.length(1)
      expect(text(element)).to.contain('1 of these songs is already in your library')
      expect(text(element)).to.contain('updated: the same song as in your library')
      expect(await chartOf(library[0].uuid)).to.contain('{key: D}')
      expect(await chartOf(library[1].uuid)).to.contain('{tempo: 80}')
      expect(await chartOf(library[2].uuid)).to.contain('[G]Amazing grace')
      await expect(element).to.be.accessible(A11Y)
    })

    it('makes the new key the song’s own, and keeps the setlists in the keys they had it in', async () => {
      const title = unique('Setlists keep their key')
      const song = await createSong(inKey(title, 'C', ['C', 'F']))
      const db = await getCurrentDB()
      const setlist = makeSetlist({
        id: `keeps-${crypto.randomUUID().slice(0, 8)}`,
        songs: [
          makeEntry({ songUuid: song.uuid, songId: song.id }),
          makeEntry({ order: 1, songUuid: song.uuid, songId: song.id, key: 'A' }),
        ],
      })
      await db.saveSetlist(setlist)
      const element: any = await importer()
      await element.importFiles([file('a.cho', inKey(title, 'D', ['D', 'G']))])
      await element.updateComplete

      // the song is in D now, by default and as its original
      const updated = must(await db.getSong(song.uuid))
      expect(updated.key).to.equal('D')
      expect(updated.originalKey).to.equal('D')
      // the setlist that followed the song is in C still, and the one with its own key in A
      const stored = must(await db.getSetlist(setlist.id))
      expect(stored.songs.map(entry => entry.key)).to.deep.equal(['C', 'A'])
    })

    it('says how far it has got, when there are several to update', async () => {
      const titles = [unique('First'), unique('Second'), unique('Third')]
      for (const title of titles) await createSong(inKey(title, 'C', ['C', 'F']))
      const element: any = await importer()
      const seen: string[] = []
      const setChoice = element._setChoice.bind(element)
      element._setChoice = (...args: unknown[]) => {
        seen.push(element._applying)
        return setChoice(...args)
      }
      await element.importFiles(
        titles.map(title => file(`${title}.cho`, inKey(title, 'D', ['D', 'G'])))
      )
      expect(seen).to.deep.equal(['Importing 1 of 3…', 'Importing 2 of 3…', 'Importing 3 of 3…'])
      expect(element._applying).to.equal('')
      expect(asked(element)).to.have.length(0)
      expect($(element, '.choices')).to.exist
    })

    it('does not leave the comparison on the page while it updates', async () => {
      const title = unique('No flicker')
      await createSong(inKey(title, 'C', ['C', 'F']))
      const element: any = await importer()
      const shown: boolean[] = []
      const setChoice = element._setChoice.bind(element)
      element._setChoice = (...args: unknown[]) => {
        shown.push(Boolean($(element, '.duplicate')))
        return setChoice(...args)
      }
      await element.importFiles([file('a.cho', inKey(title, 'D', ['D', 'G']))])
      expect(shown).to.deep.equal([false])
    })

    it('leaves a library chart from SongSelect alone when the same song comes from somewhere less sure', async () => {
      const title = unique('Library chart')
      const song = await createSong(chart(title, '[C]Same words'), {
        importSource: 'songselect',
      } as never)
      const element: any = await importer()
      // (a file with none of SongSelect's material, with another detail)
      await element.importFiles([
        file('a.cho', chart(title, '[C]Same words').replace('{key: C}', '{key: C}\n{tempo: 99}')),
      ])
      await element.updateComplete
      expect(element._imports[0].auto).to.equal(undefined)
      expect(element._imports[0].pick).to.equal('use-existing')
      expect(text(element)).to.contain('This song already exists in your library')
      expect(await chartOf(song.uuid)).to.not.contain('{tempo: 99}')
    })

    it('updates a library chart from SongSelect with one that is from SongSelect too', async () => {
      const title = unique('Both official')
      const song = await createSong(chart(title, '[C]Same words'), {
        importSource: 'songselect',
      } as never)
      const element: any = await importer()
      await element.receive({
        chordproText: chart(title, '[C]Same words').replace('{key: C}', '{key: C}\n{tempo: 99}'),
        source: 'songselect',
      })
      expect(element._imports[0].choice).to.equal('update')
      expect(await chartOf(song.uuid)).to.contain('{tempo: 99}')
    })

    it('asks about the others as a list, with a choice for all of them', async () => {
      const titles = [unique('Chords one'), unique('Chords two'), unique('Chords three')]
      for (const title of titles) await createSong(sameWords(title, 'G'))
      const element: any = await importer()
      await element.importFiles(titles.map(title => file(`${title}.cho`, sameWords(title, 'D'))))
      await element.updateComplete
      expect(text(element)).to.contain('For all of them:')
      expect(text(element)).to.contain('Update all 3')
      expect(text(element)).to.not.contain('that are the same song')
      expect(picks(element)).to.deep.equal(['as-variant', 'as-variant', 'as-variant'])
      $(element, '.bulk-update-all').click()
      await element.updateComplete
      expect(picks(element)).to.deep.equal(['update', 'update', 'update'])
      $(element, '.apply-all').click()
      await waitFor(() => $(element, '.choices'))
      for (const title of titles) {
        const [existing] = await (await getCurrentDB()).findSongByNormalizedTitle(
          title.toLowerCase().replace(/[^a-z0-9]/g, '')
        )
        expect(await chartOf(existing.uuid)).to.contain('[D]Amazing grace')
      }
    })

    it('imports none of them when asked not to', async () => {
      const titles = [unique('Skip one'), unique('Skip two')]
      const library: SongRecord[] = []
      for (const title of titles) library.push(await createSong(sameWords(title, 'G')))
      const element: any = await importer()
      await element.importFiles(titles.map(title => file(`${title}.cho`, sameWords(title, 'D'))))
      await element.updateComplete
      $(element, '.bulk-skip').click()
      await element.updateComplete
      expect(picks(element)).to.deep.equal(['use-existing', 'use-existing'])
      $(element, '.apply-all').click()
      await waitFor(() => $(element, '.choices'))
      expect(await chartOf(library[0].uuid)).to.contain('[G]Amazing grace')
    })

    it('has no choice for all of them when only one is asked about, or the page is about one song', async () => {
      const { element } = await threeDuplicates()
      expect($(element, '.bulk-picks')).to.equal(null)
      const title = unique('Only one')
      await createSong(sameWords(title, 'G'))
      const single: any = await importer()
      await single.importFiles([file('a.cho', sameWords(title, 'D'))])
      await single.updateComplete
      expect($(single, '.bulk-picks')).to.equal(null)
    })

    it('leaves a duplicate already decided as it is', async () => {
      const titles = [unique('Decided'), unique('Undecided one'), unique('Undecided two')]
      for (const title of titles) await createSong(sameWords(title, 'G'))
      const element: any = await importer()
      await element.importFiles(titles.map(title => file(`${title}.cho`, sameWords(title, 'D'))))
      await element.updateComplete
      await element._applyPicks([{ ...element._imports[0], pick: 'use-existing' }])
      $(element, '.bulk-update-all').click()
      await element.updateComplete
      // (the first was decided; the two left were picked)
      expect(picks(element)[1]).to.equal('update')
      expect(picks(element)[2]).to.equal('update')
    })
  })

  describe('a chart of a song the library has', () => {
    it('is not asked about when it is the same chart', async () => {
      const title = unique('Same')
      await createSong(chart(title, '[G]Same'))
      const element: any = await importer()
      await paste(element, chart(title, '[G]Same'))
      expect(text(element)).to.not.contain('already exists')
      expect($(element, '.choices')).to.not.equal(null)
    })

    it('says how it differs, puts the choices above the charts, and leads with a variant for other chords', async () => {
      const title = unique('Chords')
      await createSong(chart(title, '[G]Amazing grace'), { importUser: 'Simon' } as never)
      const element: any = await importer()
      await paste(element, chart(title, '[Am]Amazing grace'))
      expect(text(element)).to.contain('The same words, with different chords')
      expect($(element, 'details').open).to.equal(true)
      expect($(element, 'chart-diff').shadowRoot.textContent).to.contain('Imported by Simon')
      expect($(element, '.pick-as-variant').checked).to.equal(true)
      expect($(element, '.pick-update').checked).to.equal(false)
      expect(
        $(element, '.picks').compareDocumentPosition($(element, 'details')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).to.not.equal(0)
      expect(
        $(element, '.apply').compareDocumentPosition($(element, 'details')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).to.not.equal(0)
      await expect(element).to.be.accessible(A11Y)
    })

    it('updates a change of key with no question, and leaves nothing chosen for other words', async () => {
      const key = unique('Key')
      const song = await createSong(`{title: ${key}}\n{key: C}\n[C]Amazing [F]grace`)
      const element: any = await importer()
      await paste(element, `{title: ${key}}\n{key: D}\n[D]Amazing [G]grace`)
      // (the same song, in another key: there is nothing to ask, and it is now in the new key)
      // (it is done a moment after the results are shown)
      await waitFor(() => text(element).includes('It has been updated.'))
      expect($(element, '.duplicate')).to.equal(null)
      const db = await getCurrentDB()
      expect(must(await db.getSong(song.uuid)).key).to.equal('D')
      expect(
        must(await db.getChordPro(must(await db.getSong(song.uuid)).chordproFileId)).content
      ).to.contain('{key: D}')

      const words = unique('Words')
      await createSong(chart(words, '[G]Amazing grace'))
      const other: any = await importer()
      await paste(other, chart(words, '[G]Something else'))
      expect($(other, 'input[type=radio]:checked')).to.equal(null)
      expect($(other, '.apply').disabled).to.equal(true)
    })

    it("says the same chart with other details, and who imported the library's, and its source", async () => {
      const title = unique('Details')
      await createSong(`{title: ${title}}\n{key: C}\n[C]Amazing grace`, {
        importUser: 'Simon',
        importSource: 'songselect',
      } as never)
      const element: any = await importer()
      await paste(element, `{title: ${title}}\n{key: C}\n{copyright: Someone}\n[C]Amazing grace`)
      expect(text(element)).to.contain('The same words and chords, with other details')
      expect($(element, '.pick-use-existing').checked).to.equal(true)
      expect($(element, 'details').open).to.equal(false)
      const detail = $(element, 'chart-diff').shadowRoot.textContent
      expect(detail).to.contain('Imported by Simon')
      expect(detail).to.contain('SongSelect')
    })

    it("imports as the original: the import is the default, the library's chart a variant with the name typed", async () => {
      const title = unique('Original')
      const existing = await createSong(chart(title, '[G]Amazing grace'))
      const element: any = await importer()
      await paste(element, chart(title, '[Am]Amazing grace'))
      await choose(element, 'as-original', { apply: false })
      expect(text(element)).to.contain('Variant name for your current song')
      const input = $(element, '.variant-label')
      expect(input.value).to.equal('Alternate chords')
      input.value = 'Simon, capo 3'
      input.dispatchEvent(new Event('input'))
      $(element, '.apply').click()
      await waitFor(() => $(element, '.choices'))
      expect($(element, '.songs, h2').textContent).to.contain(title)

      const db = await getCurrentDB()
      const variants = (await db.getAllSongs()).filter(song => song.title === title)
      expect(variants).to.have.length(2)
      const original = must(variants.find(song => song.isDefault))
      expect(original.uuid).to.not.equal(existing.uuid)
      const kept = must(await db.getSong(existing.uuid))
      expect(kept.variantOf).to.equal(original.uuid)
      expect(kept.variantLabel).to.equal('Simon, capo 3')
    })

    it("imports as a variant: the library's chart stays the original, the import has the name typed", async () => {
      const title = unique('Variant')
      const existing = await createSong(chart(title, '[G]Amazing grace'))
      const element: any = await importer()
      await paste(element, chart(title, '[Am]Amazing grace'))
      expect($(element, '.pick-as-variant').checked).to.equal(true)
      await choose(element, 'as-variant', { apply: false })
      expect(text(element)).to.contain('Variant name for the imported song')
      const input = $(element, '.variant-label')
      input.value = 'Official'
      input.dispatchEvent(new Event('input'))
      $(element, '.apply').click()
      await waitFor(() => $(element, '.choices'))

      const db = await getCurrentDB()
      const variants = (await db.getAllSongs()).filter(song => song.title === title)
      expect(variants).to.have.length(2)
      expect(must(await db.getSong(existing.uuid)).isDefault).to.equal(true)
      const added = must(variants.find(song => song.uuid !== existing.uuid))
      expect(added.isDefault).to.equal(false)
      expect(added.variantOf).to.equal(existing.uuid)
      expect(added.variantLabel).to.equal('Official')
    })

    it('does not ask for a name when updating or not importing', async () => {
      const title = unique('No name')
      await createSong(chart(title, '[G]Amazing grace'))
      const element: any = await importer()
      await paste(element, chart(title, '[Am]Amazing grace'))
      expect($(element, '.variant-label')).to.not.equal(null)
      await choose(element, 'update', { apply: false })
      expect($(element, '.variant-label')).to.equal(null)
      await choose(element, 'use-existing', { apply: false })
      expect($(element, '.variant-label')).to.equal(null)
    })

    it('uses the theme for its colours, with none of its own', async () => {
      const title = unique('Theme')
      await createSong(chart(title, '[G]Amazing grace'))
      const element: any = await importer()
      await paste(element, chart(title, '[Am]Amazing grace'))
      const colour = getComputedStyle($(element, '.duplicate')).backgroundColor
      expect(colour).to.not.equal('rgb(255, 243, 205)')
    })
  })

  describe('the space it imports into', () => {
    /** Another space for the test, which is gone, and the current space back, afterwards */
    async function withOtherSpace(
      test: (other: { id: string; name: string }, current: string) => Promise<void>
    ) {
      const current = await ensureCurrentSpace()
      const other = await createSpace(unique('Other space'))
      // (a space with nothing in it has no tab, so it is not offered either: docs/SPACES.md)
      const db = await openSpace(other.id)
      await addChart(db, '{title: Already here}\n{key: G}\n[G]Already here', {
        variantLabel: 'Test',
        importSource: 'test',
        makeDefault: 'first',
      })
      db.db?.close()
      try {
        await test(other, current.id)
      } finally {
        await setCurrentSpace(current.id, current.name)
        await deleteSpace(other.id)
      }
    }
    const titlesIn = async (spaceId: string) =>
      (await (await openSpace(spaceId)).getAllSongs()).map(song => song.title)
    async function chooseSpace(element, spaceId: string) {
      const select = $(element, '.space')
      select.value = spaceId
      select.dispatchEvent(new Event('change'))
      await waitFor(() => element._spaceId === spaceId)
      await element.updateComplete
    }

    it('is offered when there is more than one, with the current space chosen, and says a Team', async () => {
      await withOtherSpace(async (other, current) => {
        await updateSpace(other.id, { team: { id: 't-test', role: 'writer' } })
        const element: any = await importer()
        await waitFor(() => element._spaces.length > 1)
        await element.updateComplete
        const names = [...element.shadowRoot.querySelectorAll('.space option')].map(o =>
          o.textContent.trim()
        )
        expect(names).to.include(`${other.name} (Team)`)
        // (choosing the space it is already going to changes nothing)
        await element._chooseSpace(current)
        expect(element._spaceId).to.equal(current)
        expect($(element, '.space').value).to.equal(current)
        await expect(element).to.be.accessible(A11Y)
      })
    })

    it('imports into the space chosen before the songs are read, and not the current one', async () => {
      await withOtherSpace(async (other, current) => {
        const element: any = await importer()
        await waitFor(() => element._spaces.length > 1)
        await element.updateComplete
        await chooseSpace(element, other.id)
        const title = unique('Elsewhere')
        await paste(element, chart(title))
        expect(await titlesIn(other.id)).to.include(title)
        expect(await titlesIn(current)).to.not.include(title)
      })
    })

    it('moves songs already read to the space chosen after, taking them out of the first', async () => {
      await withOtherSpace(async (other, current) => {
        const element: any = await importer()
        await waitFor(() => element._spaces.length > 1)
        await element.updateComplete
        const title = unique('Moved')
        await paste(element, chart(title))
        expect(await titlesIn(current)).to.include(title)
        await chooseSpace(element, other.id)
        // (reading again in the other space follows the change)
        for (let n = 0; n < 200 && !(await titlesIn(other.id)).includes(title); n++) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        expect(await titlesIn(other.id)).to.include(title)
        expect(await titlesIn(current)).to.not.include(title)
      })
    })

    it('cannot be changed once a choice about a duplicate has been carried out', async () => {
      await withOtherSpace(async () => {
        const title = unique('Decided')
        await createSong(chart(title, '[G]Original'))
        const element: any = await importer()
        await waitFor(() => element._spaces.length > 1)
        await paste(element, chart(title, '[A]Imported'))
        await choose(element, 'update')
        await waitFor(() => $(element, '.choices'))
        expect($(element, '.space').disabled).to.equal(true)
      })
    })

    it('takes the app to the space it imported into, to show the song there', async () => {
      await withOtherSpace(async (other, current) => {
        const element: any = await importer()
        await waitFor(() => element._spaces.length > 1)
        await element.updateComplete
        await chooseSpace(element, other.id)
        await paste(element, chart(unique('Shown there')))
        const url = finished(element)
        $(element, '.library-only').click()
        expect(await url).to.contain('/songs')
        expect((await ensureCurrentSpace()).id).to.equal(other.id)
        expect(current).to.not.equal(other.id)
      })
    })

    it('stays in the same space when importing into it', async () => {
      const current = await ensureCurrentSpace()
      const element: any = await importer()
      await paste(element, chart(unique('Here')))
      const url = finished(element)
      $(element, '.library-only').click()
      await url
      expect((await ensureCurrentSpace()).id).to.equal(current.id)
    })
  })
})

/** Wait until check() is truthy (for the importer's database work) */
async function waitFor(check, timeout = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
