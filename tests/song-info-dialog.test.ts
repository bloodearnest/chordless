import { expect } from '@open-wc/testing'
import '../src/components/song-info-dialog.ts'
import { must } from './must.ts'
import { A11Y } from './test-helpers.ts'

const { describe, it, afterEach } = window

/** A database with two songs; loading 'slow' takes a while */
function fakeDb() {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const songs = {
    slow: { uuid: 'slow', id: 'slow', title: 'Slow Song', chordproFileId: 'c-slow' },
    fast: { uuid: 'fast', id: 'fast', title: 'Fast Song', chordproFileId: 'c-fast' },
  }
  return {
    getDefaultSongVariant: async id => songs[id] ?? null,
    getSong: async uuid => songs[uuid],
    getChordPro: async id => {
      const song = must(Object.values(songs).find(each => each.chordproFileId === id))
      return { content: `{title: ${song.title}}` }
    },
    getSongUsageFromSetlists: async id => {
      if (id === 'slow') await wait(100)
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
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

  it('shows the song it was last asked for, even if an earlier one loads later', async () => {
    await setUp()
    dialog.show('slow')
    dialog.show('fast')
    await wait(200)
    expect(modal().heading).to.equal('Fast Song')
    expect(dialog.shadowRoot.querySelector('song-info').song.title).to.equal('Fast Song')
  })

  it("says so when the song can't be loaded", async () => {
    await setUp()
    await dialog.show('missing')
    await wait(50)
    const message = dialog.shadowRoot.querySelector('status-message')
    expect(message.state).to.equal('error')
    expect(message.detail).to.contain('Song not found')
  })

  it('is accessible once loaded', async () => {
    await setUp()
    dialog.show('fast')
    await wait(100)
    await expect(dialog).to.be.accessible(A11Y)
  })
})
