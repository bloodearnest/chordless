import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/setlist-overview.ts'
import { SetlistOverview } from '../src/components/setlist-overview.ts'
import { songListText } from '../src/js/setlist/song-list-text.ts'

const { describe, it, afterEach } = window

describe('the song list to paste', () => {
  it('is one line per song, with the CCLI number in brackets where there is one', () => {
    const text = songListText([
      { title: 'Amazing Grace', _canonicalSong: { ccliNumber: '22025' } },
      { title: 'From a chart', metadata: { ccli: '7' } },
      { title: 'From a trailer', metadata: { ccliSongNumber: 123 } },
      { title: 'No number', _canonicalSong: { ccliNumber: null }, metadata: {} },
    ])
    expect(text).to.equal(
      'Amazing Grace (22025)\nFrom a chart (7)\nFrom a trailer (123)\nNo number'
    )
  })

  it('is empty for an empty setlist', () => {
    expect(songListText([])).to.equal('')
  })

  describe('the button under the songs', () => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard)
    afterEach(() => {
      navigator.clipboard.writeText = original
    })

    it('is not there without songs, and copies the list when pressed', async () => {
      const overview = await fixture<SetlistOverview>(html`<setlist-overview></setlist-overview>`)
      expect(overview.querySelector('.copy-song-list')).to.equal(null)

      let copied = ''
      navigator.clipboard.writeText = async (text: string) => {
        copied = text
      }
      overview.songs = [{ title: 'One', _canonicalSong: { ccliNumber: '11' } }, { title: 'Two' }]
      await overview.updateComplete
      overview.querySelector<HTMLButtonElement>('.copy-song-list')?.click()
      await overview.updateComplete
      await Promise.resolve()
      await overview.updateComplete
      expect(copied).to.equal('One (11)\nTwo')
      expect(overview.querySelector('.copy-song-list')?.textContent).to.contain('Copied')
    })

    it('goes back to saying Copy song list, and says nothing if the clipboard refuses', async () => {
      const overview = await fixture<SetlistOverview>(html`<setlist-overview></setlist-overview>`)
      overview.songs = [{ title: 'One' }]
      await overview.updateComplete
      const button = () => overview.querySelector<HTMLButtonElement>('.copy-song-list')

      navigator.clipboard.writeText = async () => {
        throw new Error('refused')
      }
      button()?.click()
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(button()?.textContent).to.contain('Copy song list')

      const before = SetlistOverview.copiedMs
      SetlistOverview.copiedMs = 5
      navigator.clipboard.writeText = async () => {}
      button()?.click()
      await new Promise(resolve => setTimeout(resolve, 1))
      await overview.updateComplete
      expect(button()?.textContent).to.contain('Copied')
      await new Promise(resolve => setTimeout(resolve, 30))
      await overview.updateComplete
      SetlistOverview.copiedMs = before
      expect(button()?.textContent).to.contain('Copy song list')
    })
  })
})
