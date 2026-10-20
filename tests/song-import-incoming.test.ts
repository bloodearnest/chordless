/**
 * The import page's other ways in: what the system opens or another app shares (files, text, and
 * PDF charts), choosing files, and making a setlist for the songs.
 */
import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import type { SongImport } from '../src/components/song-import.ts'
import { SongImportedEvent } from '../src/components/song-import.ts'
import { type ChordlessDB, getCurrentDB } from '../src/js/db.ts'
import { offerIncoming, takeIncoming } from '../src/js/incoming-songs.ts'
import { setRouter } from '../src/js/navigation.ts'
import { createSong } from '../src/js/song-utils.ts'
import { createSpace, deleteSpace, getCurrentSpace, setCurrentSpace } from '../src/js/space.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'
import '../src/components/song-import.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const chart = (title: string, body = '[C]Hello there') => `{title: ${title}}\n{key: C}\n\n${body}`
const file = (name: string, content: string, type = '') => new File([content], name, { type })

describe('song-import: songs that arrive', () => {
  let before: { id: string | null; name: string }
  let spaceId: string
  let db: ChordlessDB
  let importer: SongImport
  let visited: string[]

  beforeEach(async () => {
    visited = []
    setRouter({
      navigate: async (url: string) => {
        visited.push(url)
        return true
      },
    })
    before = getCurrentSpace()
    const space = await createSpace(`Import ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
    db = await getCurrentDB()
  })

  afterEach(async () => {
    importer?.remove()
    await takeIncoming()
    setRouter(null)
    db.db?.close()
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  async function open() {
    importer = await fixture<SongImport>(html`<song-import></song-import>`)
    await wait(30)
    return importer
  }
  const text = () => importer.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''
  const $ = (selector: string) => importer.shadowRoot?.querySelector<HTMLElement>(selector) ?? null
  const choices = () =>
    waitUntil(() => importer._state === 'choices', 'the choices to show', { timeout: 5000 })

  describe('offered by the system or another app', () => {
    it('are taken when the page opens, files and text together', async () => {
      offerIncoming({
        files: [file('first.cho', chart('Incoming First'))],
        text: chart('Incoming Text'),
      })
      await open()
      await choices()
      expect(text()).to.contain('2 songs')
      expect((await db.getAllSongs()).map(song => song.title).sort()).to.deep.equal([
        'Incoming First',
        'Incoming Text',
      ])
    })

    it('are taken at once when the page is open', async () => {
      await open()
      offerIncoming({ files: [file('now.cho', chart('Offered Now'))], text: '   ' })
      await choices()
      expect(text()).to.contain('Offered Now')
    })

    it('are nothing, when nothing is waiting', async () => {
      await open()
      expect(importer._state).to.equal('pick')
    })

    it('stop being heard when the page has gone', async () => {
      await open()
      importer.remove()
      offerIncoming({ files: [file('late.cho', chart('Too Late'))], text: '' })
      await wait(50)
      expect((await db.getAllSongs()).length).to.equal(0)
    })

    it('has files that are not text skipped, with why', async () => {
      await open()
      offerIncoming({
        files: [file('picture.png', 'x', 'image/png'), file('good.cho', chart('Good Song'))],
        text: '',
      })
      await choices()
      expect(text()).to.contain('Not imported: picture.png: not a text file')
    })
  })

  describe('a shared PDF chart', () => {
    const pdf = (name: string) => file(name, '%PDF-1.4 not really', 'application/pdf')

    it('finds the song the library has, by the chart’s filename, and offers it', async () => {
      await createSong(chart('Amazing Grace'), {})
      offerIncoming({ files: [pdf('Amazing Grace-chords-G.pdf')], text: '' })
      await open()
      await choices()
      expect(text()).to.contain('Amazing Grace')
      expect(importer._imports[0].key).to.equal('G')
    })

    it('says a song the library lacks is to be found on SongSelect', async () => {
      await createSong(chart('Amazing Grace'), {})
      offerIncoming({ files: [pdf('Totally Different Song.pdf')], text: '' })
      await open()
      await waitUntil(() => importer._unmatched.length === 1, 'the chart to be matched')
      expect(text()).to.contain('Not in your library: Totally Different Song')
      expect($('.unmatched a')?.getAttribute('href')).to.contain('songselect.ccli.com')
    })

    it('offers the songs it might be, and takes the one the person says', async () => {
      await createSong(chart('Amazing Grace'), {})
      offerIncoming({ files: [pdf('Amazing Grace Medley.pdf')], text: '' })
      await open()
      await waitUntil(() => importer._unmatched.length === 1, 'the chart to be matched')
      const use = $('.unmatched .btn')
      expect(use?.textContent).to.contain('Use Amazing Grace')
      use?.click()
      await choices()
      expect(importer._unmatched).to.have.length(0)
      expect(importer._imports.map(item => item.song.title)).to.deep.equal(['Amazing Grace'])
    })

    it('offers a song once, even if two charts are for it', async () => {
      await createSong(chart('Amazing Grace'), {})
      offerIncoming({
        files: [pdf('Amazing Grace.pdf'), pdf('Amazing Grace-chords-D.pdf')],
        text: '',
      })
      await open()
      await choices()
      await wait(50)
      expect(importer._imports).to.have.length(1)
    })

    it('does not offer a song that was not found in the library any more', async () => {
      await open()
      importer._db = db
      await importer._addLibrarySongs([{ uuid: 'gone', key: null }])
      expect(importer._state).to.equal('pick')
    })

    it('uses the filename when the PDF reader cannot be loaded', async () => {
      await createSong(chart('Amazing Grace'), {})
      await open()
      importer.loadPdfReader = () => Promise.reject(new Error('no reader'))
      await importer._matchCharts([pdf('Amazing Grace.pdf')])
      expect(importer._imports.map(item => item.song.title)).to.deep.equal(['Amazing Grace'])
    })

    it('says so when it cannot read the chart', async () => {
      await open()
      importer.loadPdfReader = async () => ({
        readPdfText: async () => {
          throw new Error('damaged')
        },
      })
      await importer._matchCharts([pdf('Broken.pdf')])
      expect(importer._error).to.contain('Failed to read the chart: damaged')
    })

    it('takes songs along with the PDF', async () => {
      await createSong(chart('Amazing Grace'), {})
      offerIncoming({
        files: [file('other.cho', chart('Alongside')), pdf('Amazing Grace.pdf')],
        text: '',
      })
      await open()
      await waitUntil(() => importer._imports.length === 2, 'both to be offered')
    })
  })

  describe('chosen with the file picker', () => {
    it('imports the files, and clears the choice so the same files can be chosen again', async () => {
      await open()
      const input = must($('input[type="file"]')) as HTMLInputElement
      const transfer = new DataTransfer()
      transfer.items.add(file('one.cho', chart('Chosen One')))
      input.files = transfer.files
      input.dispatchEvent(new Event('change'))
      await choices()
      expect(input.value).to.equal('')
      expect(text()).to.contain('Chosen One')
    })

    it('does nothing when no file was chosen', async () => {
      await open()
      const input = must($('input[type="file"]')) as HTMLInputElement
      input.dispatchEvent(new Event('change'))
      await wait(50)
      expect(importer._state).to.equal('pick')
    })
  })

  describe('making a setlist for the songs', () => {
    async function withSong() {
      await open()
      importer.receive({ chordproText: chart('For A Setlist'), source: 'paste' })
      await choices()
    }

    it('opens a form for next Sunday, and makes the setlist with the song in it', async () => {
      await withSong()
      $('.new-setlist')?.click()
      await waitUntil(() => importer._newSetlist, 'the form')
      expect(importer._newSetlist?.time).to.equal('10:30')
      const form = must(importer.shadowRoot?.querySelector('setlist-details-form'))
      const { SetlistDetailsSaveEvent } = await import('../src/components/setlist-details-form.ts')
      form.dispatchEvent(
        new SetlistDetailsSaveEvent({
          date: '2026-11-08',
          time: '10:30',
          type: 'Church Service',
          name: 'With Song',
          owner: '',
          ownerId: '',
        })
      )
      await waitUntil(() => visited.length === 1, 'the page to go to the setlist')
      expect(visited[0]).to.match(/^\/setlist\//)
      const [setlist] = await db.getAllSetlists()
      expect(setlist.name).to.equal('With Song')
      expect(setlist.songs).to.have.length(1)
    })

    it('says so when the setlist cannot be saved', async () => {
      await withSong()
      const real = Object.getPrototypeOf(db).saveSetlist
      Object.getPrototypeOf(db).saveSetlist = () => Promise.reject(new Error('disk full'))
      try {
        const { SetlistDetailsSaveEvent } = await import(
          '../src/components/setlist-details-form.ts'
        )
        $('.new-setlist')?.click()
        await waitUntil(() => importer._newSetlist, 'the form')
        must(importer.shadowRoot?.querySelector('setlist-details-form')).dispatchEvent(
          new SetlistDetailsSaveEvent({
            date: '2026-11-08',
            time: '',
            type: 'Other',
            name: '',
            owner: '',
            ownerId: '',
          })
        )
        await waitUntil(() => importer._error, 'the failure to be shown')
      } finally {
        Object.getPrototypeOf(db).saveSetlist = real
      }
      expect(importer._error).to.contain('Failed to create setlist: disk full')
    })

    it('closes the form on cancel', async () => {
      await withSong()
      $('.new-setlist')?.click()
      await waitUntil(() => importer._newSetlist, 'the form')
      const { SetlistDetailsCancelEvent } = await import(
        '../src/components/setlist-details-form.ts'
      )
      must(importer.shadowRoot?.querySelector('setlist-details-form')).dispatchEvent(
        new SetlistDetailsCancelEvent()
      )
      await importer.updateComplete
    })

    it('has no form to show before anything was imported', async () => {
      await open()
      expect(importer._newSetlistModal()).to.equal(undefined)
      expect(() => importer._database()).to.throw('Nothing has been imported yet')
    })
  })

  it('goes to the library when the songs are only saved to it', async () => {
    await open()
    importer.receive({ chordproText: chart('Library Only'), source: 'paste' })
    await choices()
    importer.addEventListener(SongImportedEvent.type, event => event.preventDefault(), {
      once: true,
    })
    $('.library-only')?.click()
    expect(visited).to.deep.equal([])
  })
})
