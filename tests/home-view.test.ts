import { expect } from '@open-wc/testing'
import type { Setlist } from '../src/js/data-types.ts'
import { ROUTE_NAMES } from '../src/js/router.ts'
import { groupSetlistsByDate } from '../src/js/views/home-view.ts'
import { views } from '../src/js/views/registry.ts'
import { makeEntry, makeSetlist } from './builders.ts'
import { must } from './must.ts'

const { describe, it } = window

const setlist = (id: string, date: string, songs: string[] = []) =>
  makeSetlist({
    id,
    date,
    type: 'sunday-am',
    songs: songs.map((songId, order) => makeEntry({ songId, order })),
  })

describe('groupSetlistsByDate', () => {
  const setlists = [
    setlist('a', '2025-03-02', ['x', 'y']),
    setlist('b', '2026-01-04'),
    setlist('c', '2026-06-14', ['z']),
    setlist('d', '2025-12-21'),
  ]

  const today = '2026-03-01'

  it('puts today and future setlists first, then past years newest first', () => {
    const groups = groupSetlistsByDate([...setlists, setlist('today', today)], today)
    expect(groups.map(group => group.year)).to.deep.equal(['Current and upcoming', '2026', '2025'])
    expect(groups[0].setlists.map(item => item.id)).to.deep.equal(['c', 'today'])
  })

  it('lists future and past setlists newest first within their groups', () => {
    const [upcoming, group2026, group2025] = groupSetlistsByDate(setlists, today)
    expect(upcoming.setlists.map(item => item.id)).to.deep.equal(['c'])
    expect(group2026.setlists.map(item => item.id)).to.deep.equal(['b'])
    expect(group2025.setlists.map(item => item.id)).to.deep.equal(['d', 'a'])
  })

  it('opens the current group and collapses every past year, including this year', () => {
    const groups = groupSetlistsByDate(setlists, today)
    expect(groups.map(group => group.expanded)).to.deep.equal([true, false, false])
  })

  it('names each setlist’s leader, as merged', () => {
    const people = [
      { id: 'ann', name: 'Ann', emails: [], modifiedDate: 'then', mergedInto: 'anne' },
      { id: 'anne', name: 'Anne', emails: [], modifiedDate: 'then' },
    ]
    const led = { ...setlist('l', '2026-02-01'), leaderId: 'ann' }
    const [group] = groupSetlistsByDate([led, setlist('n', '2026-01-01')], today, people)
    expect(group.setlists.map(entry => entry.leader)).to.deep.equal(['Anne', ''])
  })

  it('gives each setlist its link and song count', () => {
    const item = must(
      groupSetlistsByDate(setlists, today)[2].setlists.find(entry => entry.id === 'a')
    )
    expect(item.url).to.equal('/setlist/a')
    expect(item.songCount).to.equal(2)
    expect(item.displayName).to.be.a('string').and.not.equal('')
  })

  it('counts no songs for a setlist without a song list', () => {
    // (an old or damaged record: the type says there is always a list)
    const noSongs = { ...setlist('e', '2026-02-01'), songs: undefined } as unknown as Setlist
    expect(groupSetlistsByDate([noSongs], today)[0].setlists[0].songCount).to.equal(0)
  })

  it('files a setlist with no usable date under Unknown', () => {
    const groups = groupSetlistsByDate([setlist('f', 'someday')], today)
    expect(groups.map(group => group.year)).to.deep.equal(['Unknown'])
  })

  it('has no groups for no setlists', () => {
    expect(groupSetlistsByDate([], today)).to.deep.equal([])
  })
})

describe('the shell views', () => {
  it('are one for every route', () => {
    expect(Object.keys(views).sort()).to.deep.equal([...ROUTE_NAMES].sort())
  })
})
