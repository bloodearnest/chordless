import { expect, waitUntil } from '@open-wc/testing'
import '../src/components/song-info-dialog.ts'
import { SongRangeChangeEvent } from '../src/components/song-info.ts'
import { SongRangeChangedEvent } from '../src/components/song-info-dialog.ts'
import { SongVersionsChangedEvent } from '../src/components/song-versions.ts'
import { must } from './must.ts'
import { A11Y, clearToasts, settle, shownToast } from './test-helpers.ts'

const { describe, it, afterEach } = window

/** A database of songs; loading 'slow' waits until `releaseSlow()` */
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
    ranged: {
      uuid: 'ranged',
      id: 'ranged',
      title: 'Ranged Song',
      chordproFileId: 'c-ranged',
      chordpro: '{title: Ranged Song}\n{key: G}\n\n[G]Words',
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
  /** What saveChordPro was given, and a number of failures to give first */
  const saved: string[] = []
  const faults = { saveChordPro: 0 }
  let releaseSlow: () => void = () => {}
  const slowGate = new Promise<void>(resolve => {
    releaseSlow = resolve
  })
  return {
    saved,
    faults,
    releaseSlow: () => releaseSlow(),
    saveChordPro: async (file: { id: string; content: string }) => {
      if (faults.saveChordPro-- > 0) throw new Error('disk full')
      saved.push(file.content)
      must(Object.values(songs).find(each => each.chordproFileId === file.id)).chordpro =
        file.content
    },
    saveSong: async song => song,
    getDefaultSongVariant: async id => songs[id] ?? null,
    getSong: async uuid => songs[uuid],
    getChordPro: async id => {
      const song = must(Object.values(songs).find(each => each.chordproFileId === id))
      return { content: song.chordpro ?? `{title: ${song.title}}` }
    },
    getScore: async () => undefined,
    getSongUsageFromSetlists: async id => {
      if (id === 'slow') await slowGate
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

  /** Once the song asked for is loaded (or could not be) and drawn */
  async function loaded() {
    await dialog._load.taskComplete.catch(() => {})
    await dialog.updateComplete
    await dialog.shadowRoot.querySelector('song-info')?.updateComplete
  }

  it('shows the song it was last asked for, even if an earlier one loads later', async () => {
    await setUp()
    dialog.show('slow')
    dialog.show('fast')
    await loaded()
    // (and the slow one comes in after it)
    dialog.db.releaseSlow()
    await settle()
    await dialog.updateComplete
    expect(modal().heading).to.equal('Fast Song')
    expect(dialog.shadowRoot.querySelector('song-info').song.title).to.equal('Fast Song')
  })

  it('closes when the song it is showing is deleted, but not when only its versions change', async () => {
    await setUp()
    let closed = 0
    dialog.close = () => {
      closed++
    }
    await dialog.show('fast')
    await loaded()
    const versions = dialog.shadowRoot.querySelector('song-versions')
    versions.dispatchEvent(new SongVersionsChangedEvent())
    expect(closed).to.equal(0)
    versions.dispatchEvent(new SongVersionsChangedEvent(true))
    expect(closed).to.equal(1)
  })

  describe('setting the melody range', () => {
    const rangeChange = (range, key = 'G') => new SongRangeChangeEvent('ranged', range, key)
    const infoOf = () => dialog.shadowRoot.querySelector('song-info')

    it('saves it in the chart, shows the song as it is now, and says so to the page', async () => {
      await setUp()
      await dialog.show('ranged')
      await loaded()
      const told: (string | null)[] = []
      dialog.addEventListener(SongRangeChangedEvent.type, event => told.push(event.value))
      infoOf().dispatchEvent(rangeChange({ low: 62, high: 76 }))
      await waitUntil(() => told.length > 0)
      await loaded()
      expect(dialog.db.saved).to.have.length(1)
      expect(dialog.db.saved[0]).to.contain('{key: G}\n{x_chordless_range: D4-E5}')
      // (the song was loaded again: its chart says the range now)
      expect(infoOf().song.parsed.metadata.x_chordless_range).to.equal('D4-E5')
      expect(infoOf().shadowRoot.textContent).to.contain('D4–E5 in G')
      expect(told).to.deep.equal(['D4-E5'])
    })

    it('tells the page there is none when it is taken away', async () => {
      await setUp()
      await dialog.show('ranged')
      await loaded()
      infoOf().dispatchEvent(rangeChange({ low: 62, high: 76 }))
      await waitUntil(() => dialog.db.saved.length > 0)
      await loaded()
      const told: (string | null)[] = []
      let songId = ''
      dialog.addEventListener(SongRangeChangedEvent.type, event => {
        told.push(event.value)
        songId = event.songId
      })
      infoOf().dispatchEvent(rangeChange(null))
      await waitUntil(() => told.length > 0)
      await loaded()
      expect(told).to.deep.equal([null])
      expect(songId).to.equal('ranged')
      expect(infoOf().shadowRoot.textContent).to.contain('None yet')
    })

    it('says so in a toast, with a way to try again, when it cannot be saved', async () => {
      clearToasts()
      await setUp()
      await dialog.show('ranged')
      await loaded()
      dialog.db.faults.saveChordPro = 1
      const told: (string | null)[] = []
      dialog.addEventListener(SongRangeChangedEvent.type, event => told.push(event.value))
      infoOf().dispatchEvent(rangeChange({ low: 62, high: 76 }))
      await waitUntil(() => shownToast())
      const toast = must(shownToast())
      expect(toast.kind).to.equal('error')
      expect(toast.message).to.equal("Couldn't save the melody range.")
      expect(toast.details).to.equal('disk full')
      expect(told).to.deep.equal([])
      // (trying again, which works now)
      must(toast.action).run()
      await waitUntil(() => told.length > 0)
      expect(dialog.db.saved).to.have.length(1)
      expect(told).to.deep.equal(['D4-E5'])
      clearToasts()
    })

    it('uses the space’s own database when it was not given one, as the pages do', async () => {
      const { createSong, getSongWithContent } = await import('../src/js/song-utils.ts')
      const title = `Real database ${crypto.randomUUID().slice(0, 8)}`
      const song = await createSong(`{title: ${title}}\n{key: G}\n\n[G]Words`)
      dialog = document.createElement('song-info-dialog')
      document.body.appendChild(dialog)
      await dialog.updateComplete
      await dialog.show(song.id)
      await loaded()
      let told = false
      dialog.addEventListener(SongRangeChangedEvent.type, () => {
        told = true
      })
      infoOf().dispatchEvent(new SongRangeChangeEvent(song.uuid, { low: 62, high: 76 }, 'G'))
      await waitUntil(() => told)
      const saved = await getSongWithContent(song.uuid)
      expect(saved.parsed.metadata.x_chordless_range).to.equal('D4-E5')
    })

    it('does not look for the song again when it was given the data to show', async () => {
      await setUp()
      await dialog.showData({ song: { title: 'Shown', metadata: {}, uuid: 'ranged' } })
      const told: string[] = []
      dialog.addEventListener(SongRangeChangedEvent.type, event => told.push(event.songId))
      infoOf().dispatchEvent(rangeChange({ low: 62, high: 76 }))
      await waitUntil(() => told.length > 0)
      expect(dialog.db.saved).to.have.length(1)
      expect(told).to.deep.equal([''])
    })
  })

  it("shows the chart's CCLI number and trailer", async () => {
    await setUp()
    await dialog.show('credited')
    await loaded()
    const info = dialog.shadowRoot.querySelector('song-info').shadowRoot
    expect(info.querySelector('.modal-ccli').textContent).to.contain('7654321')
    expect(info.querySelector('.ccli-trailer').textContent).to.contain('A. Writer')
  })

  it("shows the chart's copyright, and no copyright line for a chart without one", async () => {
    await setUp()
    await dialog.show('credited')
    await loaded()
    const info = () => dialog.shadowRoot.querySelector('song-info').shadowRoot
    expect(info().textContent).to.contain('Copyright')
    expect(info().textContent).to.contain('Chords © 2026 A. Person')

    await dialog.show('fast')
    await loaded()
    expect(info().textContent).to.not.contain('Copyright')
  })

  it('shows no copyright line when the CCLI trailer says the same', async () => {
    await setUp()
    await dialog.show('repeated')
    await loaded()
    const info = dialog.shadowRoot.querySelector('song-info').shadowRoot
    expect(info.querySelector('.ccli-trailer').textContent).to.contain('A Publisher')
    expect(info.textContent).to.not.contain('Copyright')
  })

  it("says so when the song can't be loaded", async () => {
    await setUp()
    await dialog.show('missing')
    await loaded()
    const message = dialog.shadowRoot.querySelector('status-message')
    expect(message.state).to.equal('error')
    expect(message.detail).to.contain('Song not found')
  })

  it('lists where the song has been played, with the key and who led it', async () => {
    await setUp()
    await dialog.show('fast')
    await loaded()
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
    await loaded()
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
    await loaded()
    await expect(dialog).to.be.accessible(A11Y)
  })
})
