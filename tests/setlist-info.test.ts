import { expect, fixture, html } from '@open-wc/testing'
import type { SetlistInfo } from '../src/components/setlist-info.ts'
import '../src/components/setlist-info.ts'

const { describe, it } = window

type Setlist = NonNullable<SetlistInfo['setlist']>

const setlist = (over: Record<string, unknown> = {}) =>
  ({ id: 's1', songs: [], ...over }) as unknown as Setlist

describe('setlist-info', () => {
  async function show(set: Partial<Pick<SetlistInfo, 'setlist' | 'leader' | 'loading'>>) {
    const info = await fixture<SetlistInfo>(html`<setlist-info></setlist-info>`)
    Object.assign(info, set)
    await info.updateComplete
    return info
  }
  const text = (info: SetlistInfo) => info.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''

  it('says it is loading, or has no setlist', async () => {
    expect(text(await show({ loading: true }))).to.contain('Loading setlist information')
    expect(text(await show({ setlist: null }))).to.contain('No setlist information available')
  })

  it('shows only the song count of a bare setlist', async () => {
    const shown = text(await show({ setlist: setlist({ songs: [{}] }) }))
    expect(shown).to.contain('Songs 1 song')
    expect(shown).to.not.contain('Time')
    expect(shown).to.not.contain('Leader')
    expect(shown).to.not.contain('Created')
  })

  it('says songs for any other number, including none', async () => {
    expect(text(await show({ setlist: setlist({ songs: [{}, {}] }) }))).to.contain('2 songs')
    expect(text(await show({ setlist: setlist({ songs: undefined }) }))).to.contain('0 songs')
  })

  it('shows what the setlist has, with the leader given or else the one who shared it', async () => {
    const full = setlist({
      time: '10:30',
      type: 'Sunday service',
      venue: 'The hall',
      received: { leaderName: ' Ann ' } as never,
      createdDate: '2026-01-02T10:00:00Z',
      modifiedDate: '2026-02-03T10:00:00Z',
    })
    const shown = text(await show({ setlist: full }))
    for (const part of [
      'Time 10:30',
      'Type Sunday service',
      'Leader Ann',
      'Venue The hall',
      'Created',
      'Last Modified',
    ]) {
      expect(shown, part).to.contain(part)
    }
    expect(text(await show({ setlist: full, leader: 'Ben' }))).to.contain('Leader Ben')
  })

  it('leaves out an item with no value', async () => {
    const info = await show({ setlist: setlist() })
    expect(info._renderInfoItem('Empty', '')).to.equal('')
  })
})
