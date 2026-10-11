import { expect, fixture, html } from '@open-wc/testing'
import { SongImportedEvent } from '../src/components/song-import.ts'
import { createSetlist, getCurrentDB } from '../src/js/db.ts'
import { createSong } from '../src/js/song-utils.ts'
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
    $(element, '.use-existing').click()
    await element.updateComplete

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
    $(element, '.update').click()
    await waitFor(() => !text(element).includes('already exists in your library'))

    const db = await getCurrentDB()
    const song = must(await db.getSong(existing.uuid))
    expect(must(await db.getChordPro(song.chordproFileId)).content).to.contain('[A]Imported')
  })

  it('asks about each song already in the library among several, with Update All', async () => {
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

    $(element, '.update-all').click()
    await waitFor(() => $(element, '.choices'))
    expect($(element, '.songs').textContent).to.contain('updated')

    const db = await getCurrentDB()
    const song = must(await db.getSong(existing.uuid))
    expect(must(await db.getChordPro(song.chordproFileId)).content).to.contain('[A]Updated')
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
