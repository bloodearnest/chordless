import { expect, fixture, html } from '@open-wc/testing'
import {
  OverviewAddSongEvent,
  OverviewGoLiveEvent,
  OverviewLeaveLiveEvent,
  OverviewSongClickEvent,
  OverviewSongDeleteEvent,
  OverviewSongKeyChangeEvent,
  type SetlistOverview,
} from '../src/components/setlist-overview.ts'
import {
  SongCardClickEvent,
  SongCardDeleteEvent,
  SongCardKeyChangeEvent,
  type SongCardSong,
} from '../src/components/song-card.ts'
import '../src/components/setlist-overview.ts'

const { describe, it } = window

const songs: SongCardSong[] = [
  { title: 'First', metadata: { key: 'G' } },
  { title: 'Second', metadata: { key: 'D' } },
]

describe('setlist-overview', () => {
  async function show(editMode = false) {
    const overview = await fixture<SetlistOverview>(html`<setlist-overview></setlist-overview>`)
    overview.songs = songs
    overview.editMode = editMode
    await overview.updateComplete
    return overview
  }

  const cardAt = (overview: SetlistOverview, index: number) =>
    overview.querySelectorAll('song-card')[index]

  it('has no songs to start with, and an Add Song button', async () => {
    const overview = await fixture<SetlistOverview>(html`<setlist-overview></setlist-overview>`)
    expect(overview.querySelectorAll('song-card')).to.have.length(0)
    expect(overview.querySelector<HTMLElement>('.add-song-button')?.hidden).to.equal(false)
  })

  it('shows a card for each song, and the Add Song button whether or not it is in edit mode', async () => {
    const overview = await show(true)
    expect(overview.querySelectorAll('song-card')).to.have.length(2)
    expect(overview.querySelector<HTMLElement>('.add-song-button')?.hidden).to.equal(false)
    overview.editMode = false
    await overview.updateComplete
    expect(overview.querySelector<HTMLElement>('.add-song-button')?.checkVisibility()).to.equal(
      true
    )
  })

  it('says which song was clicked, deleted or given another key, by its place', async () => {
    const overview = await show(true)
    const seen: string[] = []
    overview.addEventListener(OverviewSongClickEvent.type, event =>
      seen.push(`click ${(event as OverviewSongClickEvent).index}`)
    )
    overview.addEventListener(OverviewSongDeleteEvent.type, event =>
      seen.push(`delete ${(event as OverviewSongDeleteEvent).index}`)
    )
    overview.addEventListener(OverviewSongKeyChangeEvent.type, event => {
      const { index, key } = event as OverviewSongKeyChangeEvent
      seen.push(`key ${index} ${key}`)
    })
    cardAt(overview, 1).dispatchEvent(new SongCardClickEvent(songs[1]))
    cardAt(overview, 0).dispatchEvent(new SongCardDeleteEvent(songs[0]))
    cardAt(overview, 1).dispatchEvent(new SongCardKeyChangeEvent('E'))
    expect(seen).to.deep.equal(['click 1', 'delete 0', 'key 1 E'])
  })

  it('says when Add Song is pressed', async () => {
    const overview = await show(true)
    let added = 0
    overview.addEventListener(OverviewAddSongEvent.type, () => added++)
    overview.querySelector<HTMLButtonElement>('.add-song-button')?.click()
    expect(added).to.equal(1)
  })

  describe('live', () => {
    const live = (overview: SetlistOverview) => overview.querySelector('#overview-live')

    it('offers Go live, which says when it is pressed', async () => {
      const overview = await show()
      expect(live(overview)?.getAttribute('data-live')).to.equal('none')
      expect(overview.querySelector('#go-live-button')?.textContent).to.contain('Go live')
      let pressed = 0
      overview.addEventListener(OverviewGoLiveEvent.type, () => pressed++)
      overview.querySelector<HTMLButtonElement>('#go-live-button')?.click()
      expect(pressed).to.equal(1)
    })

    it('offers to take over when another setlist is live', async () => {
      const overview = await show()
      overview.liveState = 'other'
      await overview.updateComplete
      expect(live(overview)?.getAttribute('data-live')).to.equal('other')
      expect(overview.querySelector('#go-live-button')?.textContent).to.contain('Take over')
    })

    it('says Live now when this setlist is live, with a way to leave, which says when it is pressed', async () => {
      const overview = await show()
      overview.liveState = 'this'
      await overview.updateComplete
      expect(live(overview)?.textContent).to.contain('Live now')
      expect(overview.querySelector('#go-live-button')).to.equal(null)
      let left = 0
      overview.addEventListener(OverviewLeaveLiveEvent.type, () => left++)
      overview.querySelector<HTMLButtonElement>('#leave-live-button')?.click()
      expect(left).to.equal(1)
    })
  })
})
