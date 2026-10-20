import { expect, waitUntil } from '@open-wc/testing'
import '../src/components/song-info-dialog.ts'
import { must } from './must.ts'
import { A11Y, wait } from './test-helpers.ts'

const { describe, it, afterEach } = window

/** A database with two songs; loading 'slow' takes a while */
function fakeDb() {
  const songs: Record<
    string,
    { uuid: string; id: string; title: string; chordproFileId: string; chordpro?: string }
  > = {
    slow: { uuid: 'slow', id: 'slow', title: 'Slow Song', chordproFileId: 'c-slow' },
    fast: { uuid: 'fast', id: 'fast', title: 'Fast Song', chordproFileId: 'c-fast' },
    credited: {
      uuid: 'credited',
      id: 'credited',
      title: 'Credited Song',
      chordproFileId: 'c-credited',
      chordpro:
        '{title: Credited Song}\n{copyright: Words PD. Chords © 2026 A. Person}\n[G]Words\nCCLI Song # 7654321\nA. Writer\n© 2020 A Publisher',
    },
    repeated: {
      uuid: 'repeated',
      id: 'repeated',
      title: 'Repeated Song',
      chordproFileId: 'c-repeated',
      chordpro:
        '{title: Repeated Song}\n{copyright: 2020 A Publisher}\n[G]Words\nCCLI Song # 7654321\nA. Writer\n© 2020  A Publisher',
    },
  }
  return {
    getDefaultSongVariant: async id => songs[id] ?? null,
    getSong: async uuid => songs[uuid],
    getChordPro: async id => {
      const song = must(Object.values(songs).find(each => each.chordproFileId === id))
      return { content: song.chordpro ?? `{title: ${song.title}}` }
    },
    getSongUsageFromSetlists: async id => {
      if (id === 'slow') await wait(100)
      if (id === 'fast') {
        return [
          {
            setlistId: 'setlist-1',
            setlistDate: '2026-10-11',
            playedInKey: 'A',
            leader: 'Ann Smith',
            setlistName: 'Harvest',
          },
        ]
      }
      return []
    },
  }
}

describe('song-info-dialog', () => {
  let dialog

  afterEach(() => dialog?.remove())

  async function setUp() {
    dialog = document.createElement('song-info-dialog')
    dialog.db = fakeDb()
    document.body.appendChild(dialog)
    await dialog.updateComplete
    return dialog
  }

  const modal = () => dialog.shadowRoot.querySelector('app-modal')

  it('shows the song it was last asked for, even if an earlier one loads later', async () => {
    await setUp()
    dialog.show('slow')
    dialog.show('fast')
    await wait(200)
    expect(modal().heading).to.equal('Fast Song')
    expect(dialog.shadowRoot.querySelector('song-info').song.title).to.equal('Fast Song')
  })

  it("shows the chart's CCLI number and trailer", async () => {
    await setUp()
    await dialog.show('credited')
    await wait(100)
    const info = dialog.shadowRoot.querySelector('song-info').shadowRoot
    expect(info.querySelector('.modal-ccli').textContent).to.contain('7654321')
    expect(info.querySelector('.ccli-trailer').textContent).to.contain('A. Writer')
  })

  it("shows the chart's copyright, and no copyright line for a chart without one", async () => {
    await setUp()
    await dialog.show('credited')
    await wait(100)
    const info = () => dialog.shadowRoot.querySelector('song-info').shadowRoot
    expect(info().textContent).to.contain('Copyright')
    expect(info().textContent).to.contain('Chords © 2026 A. Person')

    await dialog.show('fast')
    await wait(100)
    expect(info().textContent).to.not.contain('Copyright')
  })

  it('shows no copyright line when the CCLI trailer says the same', async () => {
    await setUp()
    await dialog.show('repeated')
    await wait(100)
    const info = dialog.shadowRoot.querySelector('song-info').shadowRoot
    expect(info.querySelector('.ccli-trailer').textContent).to.contain('A Publisher')
    expect(info.textContent).to.not.contain('Copyright')
  })

  it("says so when the song can't be loaded", async () => {
    await setUp()
    await dialog.show('missing')
    await wait(50)
    const message = dialog.shadowRoot.querySelector('status-message')
    expect(message.state).to.equal('error')
    expect(message.detail).to.contain('Song not found')
  })

  it('lists where the song has been played, with the key and who led it', async () => {
    await setUp()
    await dialog.show('fast')
    await wait(100)
    expect(dialog.shadowRoot.querySelector('song-info').appearances).to.deep.equal([
      {
        setlistId: 'setlist-1',
        date: '2026-10-11',
        playedInKey: 'A',
        leader: 'Ann Smith',
        setlistName: 'Harvest',
      },
    ])
  })

  it('shows the title it is given in place of the song’s own', async () => {
    await setUp()
    await dialog.show('fast', { title: 'Fast Song (our version)' })
    await wait(100)
    expect(modal().heading).to.equal('Fast Song (our version)')
  })

  it('looks in the space’s database when it is not given one', async () => {
    dialog = document.createElement('song-info-dialog')
    document.body.appendChild(dialog)
    await dialog.updateComplete
    await dialog.show('title-not-in-any-library')
    const status = () => dialog.shadowRoot.querySelector('status-message')
    await waitUntil(() => status()?.state === 'error', 'the dialog says it found no song', {
      timeout: 5000,
    })
    expect(status().state).to.equal('error')
  })

  it('shows data it is given, with “Song info” as the heading when there is no song', async () => {
    await setUp()
    await dialog.showData({ song: { title: 'Given Song' }, appearances: [] })
    expect(modal().heading).to.equal('Given Song')
    expect(dialog.shadowRoot.querySelector('song-info').song.title).to.equal('Given Song')

    await dialog.showData({ song: null, loading: true })
    expect(modal().heading).to.equal('Song info')
    expect(dialog.shadowRoot.querySelector('song-info').loading).to.equal(true)
  })

  it('closes when asked', async () => {
    await setUp()
    await dialog.showData({ song: { title: 'Given Song' } })
    await modal().updateComplete
    expect(modal().open).to.equal(true)
    dialog.close()
    await modal().updateComplete
    expect(modal().open).to.equal(false)
  })

  it('is accessible once loaded', async () => {
    await setUp()
    dialog.show('fast')
    await wait(100)
    await expect(dialog).to.be.accessible(A11Y)
  })
})
