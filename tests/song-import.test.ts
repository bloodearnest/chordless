import { expect, fixture, html } from '@open-wc/testing'
import { SongImportedEvent } from '../src/components/song-import.ts'
import { createSetlist, getCurrentDB, openSpace } from '../src/js/db.ts'
import { addChart, createSong } from '../src/js/song-utils.ts'
import {
  createSpace,
  deleteSpace,
  ensureCurrentSpace,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
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

    it('leads with not importing for a change of key, and with nothing for other words', async () => {
      const key = unique('Key')
      await createSong(`{title: ${key}}\n{key: C}\n[C]Amazing [F]grace`)
      const element: any = await importer()
      await paste(element, `{title: ${key}}\n{key: D}\n[D]Amazing [G]grace`)
      expect(text(element)).to.contain('The same song in another key')
      expect($(element, '.pick-use-existing').checked).to.equal(true)

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
