import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/song-list.ts'
import type { SongCard } from '../src/components/song-card.ts'
import { type SongList, SongSelectEvent } from '../src/components/song-list.ts'
import type { SongWithContent } from '../src/js/data-types.ts'
import { must } from './must.ts'

const { describe, it } = window

describe('song-list', () => {
  const songs = ['Alpha', 'Bravo', 'Charlie'].map(
    title => ({ title, id: title }) as unknown as SongWithContent
  )

  async function show(set: Partial<SongList> = {}) {
    const list = await fixture<SongList>(html`<song-list></song-list>`)
    Object.assign(list, set)
    await list.updateComplete
    return list
  }
  const cards = (list: SongList) =>
    Array.from(list.shadowRoot?.querySelectorAll<SongCard>('song-card') ?? [])

  it('shows a card for each song, in the variant and with the search it was given', async () => {
    const list = await show({ songs, variant: 'setlist', search: 'al' })
    expect(cards(list).map(card => card.song?.title)).to.deep.equal(['Alpha', 'Bravo', 'Charlie'])
    expect(cards(list)[0].variant).to.equal('setlist')
    expect(cards(list)[0].search).to.equal('al')
  })

  it('says there are none, with the message it was given, when it has no songs', async () => {
    const list = await show({
      songs: [],
      emptyMessage: 'No songs match.',
      emptyDetail: 'Try again',
    })
    const message = list.shadowRoot?.querySelector('status-message')
    expect(message?.state).to.equal('empty')
    expect(message?.message).to.equal('No songs match.')
    expect(message?.detail).to.equal('Try again')
    expect((await show()).shadowRoot?.querySelector('status-message')).to.not.equal(null)
  })

  it('says which song was chosen, and its place, when its card is', async () => {
    const list = await show({ songs })
    const chosen: [string, number][] = []
    list.addEventListener(SongSelectEvent.type, event => {
      const { song, index } = event as SongSelectEvent
      chosen.push([song.title, index])
    })
    must(cards(list)[1].shadowRoot?.querySelector<HTMLElement>('.card')).click()
    expect(chosen).to.deep.equal([['Bravo', 1]])
  })
})
