import { expect, fixture, html } from '@open-wc/testing'
import { PitchChangeEvent, type PitchSelector } from '../src/components/pitch-selector.ts'
import {
  OverviewAddSongEvent,
  OverviewPitchChangeEvent,
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

  it('has no editors or delete buttons for someone who does not control the setlist, except on the songs they added', async () => {
    const overview = await show(true)
    overview.controls = false
    overview.songs = [
      songs[0],
      { ...songs[1], _setlistEntry: { songUuid: 'u', local: true } } as SongCardSong,
    ]
    await overview.updateComplete
    const [shared, mine] = Array.from(overview.querySelectorAll('song-card'))
    await Promise.all([shared.updateComplete, mine.updateComplete])
    expect(shared.editMode).to.equal(false)
    expect(shared.local).to.equal(false)
    expect(mine.editMode).to.equal(true)
    expect(mine.local).to.equal(true)
    expect(mine.shadowRoot?.querySelector('.local-mark')?.textContent).to.equal('Just me')
    overview.controls = true
    await overview.updateComplete
    expect(shared.editMode).to.equal(true)
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

  describe('the instrument pitch for the setlist', () => {
    const row = (overview: SetlistOverview) =>
      overview.querySelector<PitchSelector>('pitch-selector')

    it('has a row for it when the pitch controls are on and it is edit mode, and none otherwise', async () => {
      const overview = await show(true)
      expect(row(overview)).to.equal(null)
      overview.showPitch = true
      await overview.updateComplete
      expect(row(overview)).to.not.equal(null)
    })

    it('shows it out of edit mode only when it is not concert pitch, the setlist’s own or the device’s', async () => {
      const overview = await show()
      overview.showPitch = true
      await overview.updateComplete
      expect(row(overview)).to.equal(null)
      overview.devicePitch = 'eb'
      await overview.updateComplete
      expect(row(overview)?._displayValue()).to.equal('E♭')
      overview.pitch = 'concert'
      await overview.updateComplete
      expect(row(overview)).to.equal(null)
      overview.pitch = 'bb'
      await overview.updateComplete
      expect(row(overview)?._displayValue()).to.equal('B♭')
      expect(row(overview)?.editMode).to.equal(false)
      overview.editMode = true
      await overview.updateComplete
      expect(row(overview)?.editMode).to.equal(true)
    })

    it('says which pitch was chosen, once, and null for the device’s', async () => {
      const overview = await show(true)
      overview.showPitch = true
      await overview.updateComplete
      const seen: (string | null)[] = []
      overview.addEventListener(OverviewPitchChangeEvent.type, event =>
        seen.push((event as OverviewPitchChangeEvent).pitch)
      )
      row(overview)?.dispatchEvent(new PitchChangeEvent('f'))
      row(overview)?.dispatchEvent(new PitchChangeEvent(null))
      expect(seen).to.deep.equal(['f', null])
    })
  })

  describe('the tuning of the guitar for the setlist', () => {
    const row = (overview: SetlistOverview) =>
      overview.querySelector<TuningSelector>('tuning-selector')

    it('has a row for it when the capo and tuning controls are on, and none otherwise', async () => {
      const overview = await show(true)
      expect(row(overview)).to.equal(null)
      overview.showTuning = true
      await overview.updateComplete
      expect(row(overview)).to.not.equal(null)
    })

    it('shows it always in edit mode, and out of it only when it is not standard', async () => {
      const overview = await show()
      overview.showTuning = true
      await overview.updateComplete
      // (standard, the setlist's own or the device's: nothing to say)
      expect(row(overview)).to.equal(null)
      overview.deviceTuning = 1
      await overview.updateComplete
      expect(row(overview)?._displayValue()).to.equal('Half step down')
      // (a setlist standard in itself, over a device that is not: standard, so nothing to say)
      overview.tuning = 0
      await overview.updateComplete
      expect(row(overview)).to.equal(null)
      overview.tuning = 2
      await overview.updateComplete
      expect(row(overview)?._displayValue()).to.equal('Whole step down')
      // (and in edit mode it is there to be changed, whatever it is)
      overview.tuning = 0
      overview.editMode = true
      await overview.updateComplete
      expect(row(overview)?._displayValue()).to.equal('Standard')
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
