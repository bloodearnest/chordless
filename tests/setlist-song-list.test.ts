import { expect, fixture, html } from '@open-wc/testing'
import { SetlistShare } from '../src/components/setlist-share.ts'
import type { Setlist } from '../src/js/data-types.ts'
import { songListHtml, songListText, ukDate } from '../src/js/setlist/song-list-text.ts'

const { describe, it, afterEach } = window

const setlist = (extra: Partial<Setlist> = {}) =>
  ({
    id: 's1',
    date: '2026-10-25',
    time: '10:30',
    type: 'Church Service',
    name: 'Harvest',
    owner: 'Sam',
    songs: [],
    ...extra,
  }) as Setlist

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

  it('can leave out the title line and add SongSelect links, and be rich text', () => {
    const songs = [{ title: 'A & B', _canonicalSong: { ccliNumber: '22025' } }, { title: 'Two' }]
    const list = setlist({ date: '2026-10-18' })
    expect(songListText(songs, list, { title: false, links: true })).to.equal(
      'Worship Leader: Sam\n\nA & B (22025) https://songselect.ccli.com/songs/22025\nTwo'
    )
    expect(
      songListText(songs, setlist({ date: '2026-10-18', owner: '' }), { title: false })
    ).to.equal('A & B (22025)\nTwo')
    expect(songListHtml(songs, list)).to.equal(
      '<p>Songs for Sunday 18th October<br>Worship Leader: Sam</p>' +
        '<p><a href="https://songselect.ccli.com/songs/22025">A &amp; B</a> (22025)<br>Two</p>'
    )
    expect(songListHtml(songs)).to.not.contain('Songs for')
  })

  it('is headed by the UK date and the leader, leaving out the leader when there is none', () => {
    const songs = [{ title: 'One', _canonicalSong: { ccliNumber: '22025' } }]
    expect(songListText(songs, setlist({ date: '2026-10-18' }))).to.equal(
      'Songs for Sunday 18th October\nWorship Leader: Sam\n\nOne (22025)'
    )
    expect(songListText(songs, setlist({ date: '2026-10-22', owner: '' }))).to.equal(
      'Songs for Thursday 22nd October\n\nOne (22025)'
    )
    expect(ukDate('2026-11-01')).to.equal('Sunday 1st November')
    expect(ukDate('2026-11-12')).to.equal('Thursday 12th November')
    expect(ukDate('2026-11-23')).to.equal('Monday 23rd November')
    expect(ukDate('nonsense')).to.equal('nonsense')
  })

  describe('in the share modal', () => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard)
    const originalWrite = navigator.clipboard.write.bind(navigator.clipboard)
    afterEach(() => {
      navigator.clipboard.writeText = original
      navigator.clipboard.write = originalWrite
    })
    /** The clipboard cannot write rich text: the plain text goes through writeText */
    const noRichText = () => {
      navigator.clipboard.write = async () => {
        throw new Error('no rich text')
      }
    }

    const open = async (linkable = true) => {
      const el = await fixture<SetlistShare>(
        html`<setlist-share
          .setlist=${setlist()}
          .songs=${[{ title: 'One', _canonicalSong: { ccliNumber: '22025' } }, { title: 'Two' }]}
          .linkable=${linkable}
        ></setlist-share>`
      )
      el.show()
      await el.updateComplete
      return el
    }
    const button = (el: SetlistShare) =>
      el.shadowRoot?.querySelector<HTMLButtonElement>('#copy-song-list')

    it('is a mode next to the link, and copies the text', async () => {
      const el = await open()
      const panelOf = (id: string) => el.shadowRoot?.querySelector(id)?.closest('.panel')
      expect(panelOf('#copy-song-list')?.hasAttribute('inert')).to.equal(true)
      el.shadowRoot?.querySelector<HTMLButtonElement>('#mode-list')?.click()
      await el.updateComplete
      expect(panelOf('#copy-song-list')?.hasAttribute('inert')).to.equal(false)
      expect(el.shadowRoot?.querySelector('.panel')?.hasAttribute('inert')).to.equal(true)

      let plain = ''
      let rich = ''
      navigator.clipboard.write = async items => {
        plain = await (await items[0].getType('text/plain')).text()
        rich = await (await items[0].getType('text/html')).text()
      }
      button(el)?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
      await el.updateComplete
      expect(plain).to.contain('Worship Leader: Sam')
      expect(plain).to.contain('One (22025)\nTwo')
      expect(rich).to.contain(
        '<a href="https://songselect.ccli.com/songs/22025">One</a> (22025)<br>Two'
      )
      expect(button(el)?.textContent).to.contain('Copied')
      expect(el.shadowRoot?.querySelector('textarea')?.value).to.equal(plain)
    })

    it('copies plain text when the clipboard cannot take rich text', async () => {
      const el = await open(false)
      noRichText()
      let copied = ''
      navigator.clipboard.writeText = async (text: string) => {
        copied = text
      }
      button(el)?.click()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(copied).to.contain('One (22025)\nTwo')
    })

    it('can be emailed with the first line as subject and no address', async () => {
      const el = await open()
      const link = new URL(
        el.shadowRoot?.querySelector<HTMLAnchorElement>('#email-song-list')?.href ?? ''
      )
      const subject = link.searchParams.get('su') ?? link.searchParams.get('subject')
      const body = link.searchParams.get('body') ?? ''
      expect(subject).to.equal('Songs for Sunday 25th October')
      expect(body).to.not.contain(subject)
      expect(body.split('\n')[0]).to.equal('Worship Leader: Sam')
      expect(body).to.contain('One (22025) https://songselect.ccli.com/songs/22025\nTwo')
      expect(body).to.contain(`Sent from Chordless: https://chordless.app`)
      expect(link.pathname === '/mail/' || link.protocol === 'mailto:').to.equal(true)
      expect(decodeURIComponent(link.pathname)).to.not.contain('@')
    })

    it('is all there is when the setlist cannot be shared by link', async () => {
      const el = await open(false)
      expect(el.shadowRoot?.querySelector('#mode-link')).to.equal(null)
      expect(button(el) instanceof HTMLButtonElement).to.equal(true)
      expect(el.shadowRoot?.querySelector('input')).to.equal(null)
    })

    it('goes back to saying Copy song list, and says nothing if the clipboard refuses', async () => {
      const el = await open(false)
      noRichText()
      navigator.clipboard.writeText = async () => {
        throw new Error('refused')
      }
      button(el)?.click()
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(button(el)?.textContent).to.contain('Copy song list')

      const before = SetlistShare.copiedMs
      SetlistShare.copiedMs = 5
      navigator.clipboard.writeText = async () => {}
      button(el)?.click()
      await new Promise(resolve => setTimeout(resolve, 5))
      await el.updateComplete
      expect(button(el)?.textContent).to.contain('Copied')
      await new Promise(resolve => setTimeout(resolve, 30))
      await el.updateComplete
      SetlistShare.copiedMs = before
      expect(button(el)?.textContent).to.contain('Copy song list')
    })
  })
})
