import { expect } from '@esm-bundle/chai'
import { ROUTE_NAMES } from '../src/js/router.ts'
import { groupSetlistsByYear } from '../src/js/views/home-view.js'
import { views } from '../src/js/views/registry.js'

const { describe, it } = window

const setlist = (id, date, songs = []) => ({ id, date, time: '10:30', type: 'sunday-am', songs })

describe('groupSetlistsByYear', () => {
  const setlists = [
    setlist('a', '2025-03-02', ['x', 'y']),
    setlist('b', '2026-01-04'),
    setlist('c', '2026-06-14', ['z']),
    setlist('d', '2025-12-21'),
  ]

  it('groups by year, newest year first', () => {
    expect(groupSetlistsByYear(setlists, 2026).map(group => group.year)).to.deep.equal([
      '2026',
      '2025',
    ])
  })

  it('lists the newest setlist first within a year', () => {
    const [group2026, group2025] = groupSetlistsByYear(setlists, 2026)
    expect(group2026.setlists.map(item => item.id)).to.deep.equal(['c', 'b'])
    expect(group2025.setlists.map(item => item.id)).to.deep.equal(['d', 'a'])
  })

  it('expands only the current year', () => {
    const groups = groupSetlistsByYear(setlists, 2026)
    expect(groups.map(group => group.expanded)).to.deep.equal([true, false])
  })

  it('gives each setlist its link and song count', () => {
    const item = groupSetlistsByYear(setlists, 2026)[1].setlists.find(entry => entry.id === 'a')
    expect(item.url).to.equal('/setlist/a')
    expect(item.songCount).to.equal(2)
    expect(item.displayName).to.be.a('string').and.not.equal('')
  })

  it('counts no songs for a setlist without a song list', () => {
    const noSongs = { ...setlist('e', '2026-02-01'), songs: undefined }
    expect(groupSetlistsByYear([noSongs], 2026)[0].setlists[0].songCount).to.equal(0)
  })

  it('files a setlist with no usable date under Unknown', () => {
    const groups = groupSetlistsByYear([setlist('f', 'someday')], 2026)
    expect(groups.map(group => group.year)).to.deep.equal(['Unknown'])
  })

  it('has no groups for no setlists', () => {
    expect(groupSetlistsByYear([], 2026)).to.deep.equal([])
  })
})

describe('the shell views', () => {
  it('are one for every route', () => {
    expect(Object.keys(views).sort()).to.deep.equal([...ROUTE_NAMES].sort())
  })
})
