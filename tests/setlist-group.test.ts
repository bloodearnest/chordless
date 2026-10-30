import { expect, fixture, html } from '@open-wc/testing'
import '../src/components/setlist-group.ts'
import type { SetlistGroup } from '../src/components/setlist-group.ts'

const { describe, it } = window

describe('setlist-group', () => {
  const rows = (group: SetlistGroup) =>
    Array.from(group.shadowRoot?.querySelectorAll<HTMLAnchorElement>('.setlist-button') ?? [])

  it('lists its setlists under the year, each linking to the setlist', async () => {
    const group = await fixture<SetlistGroup>(html`<setlist-group year="2026"></setlist-group>`)
    group.setlists = [
      { id: 'a', name: 'Harvest', songCount: 3 },
      { id: 'b', displayName: '25 Oct - Harvest', name: 'x', url: '/setlist/custom', songCount: 1 },
    ] as SetlistGroup['setlists']
    await group.updateComplete

    expect(group.shadowRoot?.querySelector('.year-header')?.textContent?.trim()).to.equal('2026')
    expect(rows(group).map(row => row.getAttribute('href'))).to.deep.equal([
      '/setlist/a',
      '/setlist/custom',
    ])
    expect(rows(group).map(row => row.querySelector('.setlist-name')?.textContent)).to.deep.equal([
      'Harvest',
      '25 Oct - Harvest',
    ])
    expect(
      rows(group).map(row => row.querySelector('.setlist-song-count')?.textContent?.trim())
    ).to.deep.equal(['3 songs', '1 song'])
  })

  it('names the leader under a setlist that has one', async () => {
    const group = await fixture<SetlistGroup>(html`<setlist-group year="2026"></setlist-group>`)
    group.setlists = [
      { id: 'a', name: 'Harvest', leader: 'Ann' },
      { id: 'b', name: 'Advent', leader: '' },
    ] as SetlistGroup['setlists']
    await group.updateComplete

    expect(rows(group).map(row => row.querySelector('.setlist-leader')?.textContent)).to.deep.equal(
      ['Ann', undefined]
    )
  })

  it('names the type of service, unless it is Other', async () => {
    const group = await fixture<SetlistGroup>(html`<setlist-group year="2026"></setlist-group>`)
    group.setlists = [
      { id: 'a', type: 'Church Service', leader: 'Ann' },
      { id: 'b', type: 'Event' },
      { id: 'c', type: 'Other', leader: 'Bob' },
    ] as SetlistGroup['setlists']
    await group.updateComplete

    expect(
      rows(group).map(row => row.querySelector('.setlist-meta')?.textContent?.trim())
    ).to.deep.equal(['Ann · Church Service', 'Event', 'Bob'])
  })

  it('counts the songs itself when it is not told how many, and says 0 for none', async () => {
    const group = await fixture<SetlistGroup>(html`<setlist-group year="2026"></setlist-group>`)
    group.setlists = [
      { id: 'a', songs: [{}, {}] },
      { id: 'b' },
    ] as unknown as SetlistGroup['setlists']
    await group.updateComplete
    expect(
      rows(group).map(row => row.querySelector('.setlist-song-count')?.textContent?.trim())
    ).to.deep.equal(['2 songs', '0 songs'])
    expect(rows(group).map(row => row.querySelector('.setlist-name')?.textContent)).to.deep.equal([
      '',
      '',
    ])
  })

  it('opens and closes when the year is pressed', async () => {
    const group = await fixture<SetlistGroup>(html`<setlist-group year="2026"></setlist-group>`)
    const header = group.shadowRoot?.querySelector('.year-header') as HTMLButtonElement
    expect(header.getAttribute('aria-expanded')).to.equal('false')
    header.click()
    await group.updateComplete
    expect(group.expanded).to.equal(true)
    expect(header.getAttribute('aria-expanded')).to.equal('true')
    header.click()
    await group.updateComplete
    expect(group.expanded).to.equal(false)
  })
})
