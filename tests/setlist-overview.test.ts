import { expect, fixture, html } from '@open-wc/testing'
import {
  OverviewAddSongEvent,
  OverviewSongBpmChangeEvent,
  OverviewSongClickEvent,
  OverviewSongDeleteEvent,
  OverviewSongKeyChangeEvent,
  OverviewTuningChangeEvent,
  type SetlistOverview,
} from '../src/components/setlist-overview.ts'
import {
  SongCardBpmChangeEvent,
  SongCardClickEvent,
  SongCardDeleteEvent,
  SongCardKeyChangeEvent,
  type SongCardSong,
} from '../src/components/song-card.ts'
import { TuningChangeEvent, type TuningSelector } from '../src/components/tuning-selector.ts'
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
    overview.addEventListener(OverviewSongBpmChangeEvent.type, event => {
      const { index, bpm } = event as OverviewSongBpmChangeEvent
      seen.push(`bpm ${index} ${bpm}`)
    })
    cardAt(overview, 1).dispatchEvent(new SongCardKeyChangeEvent('E'))
    cardAt(overview, 0).dispatchEvent(new SongCardBpmChangeEvent(88))
    expect(seen).to.deep.equal(['click 1', 'delete 0', 'key 1 E', 'bpm 0 88'])
  })

  describe('the tuning of the guitar for the setlist', () => {
    const row = (overview: SetlistOverview) =>
      overview.querySelector<TuningSelector>('tuning-selector')

    it('has a row for it when the capo and tuning controls are on, and none otherwise', async () => {
      const overview = await show()
      expect(row(overview)).to.equal(null)
      overview.showTuning = true
      await overview.updateComplete
      expect(row(overview)).to.not.equal(null)
    })

    it('shows the setlist’s own tuning, or the device’s when it has none, and can be changed in edit mode', async () => {
      const overview = await show()
      overview.showTuning = true
      overview.deviceTuning = 1
      await overview.updateComplete
      expect(row(overview)?._displayValue()).to.equal('Half step down')
      overview.tuning = 2
      await overview.updateComplete
      expect(row(overview)?._displayValue()).to.equal('Whole step down')
      expect(row(overview)?.editMode).to.equal(false)
      overview.editMode = true
      await overview.updateComplete
      expect(row(overview)?.editMode).to.equal(true)
    })

    it('says which tuning was chosen, once, and null for the device’s', async () => {
      const overview = await show(true)
      overview.showTuning = true
      await overview.updateComplete
      const seen: (number | null)[] = []
      overview.addEventListener(OverviewTuningChangeEvent.type, event =>
        seen.push((event as OverviewTuningChangeEvent).tuning)
      )
      row(overview)?.dispatchEvent(new TuningChangeEvent(1))
      row(overview)?.dispatchEvent(new TuningChangeEvent(null))
      expect(seen).to.deep.equal([1, null])
    })
  })

  it('says when Add Song is pressed', async () => {
    const overview = await show(true)
    let added = 0
    overview.addEventListener(OverviewAddSongEvent.type, () => added++)
    overview.querySelector<HTMLButtonElement>('.add-song-button')?.click()
    expect(added).to.equal(1)
  })
})
