import { expect, fixture, html } from '@open-wc/testing'
import {
  OverviewAddSongEvent,
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

  it('has no songs to start with, and a hidden Add Song button', async () => {
    const overview = await fixture<SetlistOverview>(html`<setlist-overview></setlist-overview>`)
    expect(overview.querySelectorAll('song-card')).to.have.length(0)
    expect(overview.querySelector<HTMLElement>('.add-song-button')?.hidden).to.equal(true)
  })

  it('shows a card for each song, and the Add Song button in edit mode', async () => {
    const overview = await show(true)
    expect(overview.querySelectorAll('song-card')).to.have.length(2)
    expect(overview.querySelector<HTMLElement>('.add-song-button')?.hidden).to.equal(false)
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
})
