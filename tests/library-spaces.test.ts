/**
 * Which spaces the library lists songs from (library-spaces.ts), and the bar that switches them
 * (library-space-filter.ts).
 */
import { expect, fixture, html } from '@open-wc/testing'
import {
  LeftOutChangeEvent,
  type LibrarySpaceFilter,
} from '../src/components/library-space-filter.ts'
import '../src/components/library-space-filter.ts'
import type { SongWithContent } from '../src/js/data-types.ts'
import {
  filterByPlace,
  loadLeftOut,
  placeOf,
  placesOf,
  saveLeftOut,
} from '../src/js/library-spaces.ts'
import { must } from './must.ts'

const { describe, it, afterEach } = window

const names = new Map([
  ['here', 'Here'],
  ['there', 'There'],
])
const own = { id: 'a', spaceId: 'here' } as SongWithContent
const theirs = { id: 'e', spaceId: 'there' } as SongWithContent
const shared = { id: 'b', source: { dbId: 'shared', label: 'Shared with me' } } as SongWithContent
const other = { id: 'c', source: { dbId: 'other', label: 'Other' } } as SongWithContent
const another = { id: 'd', source: { dbId: 'other', label: 'Other' } } as SongWithContent

describe('library places', () => {
  afterEach(() => localStorage.removeItem('library-places-left-out'))

  it('puts a song in its own space, or the database it came from', () => {
    expect(placeOf(own, names)).to.deep.equal({ id: 'here', label: 'Here' })
    expect(placeOf(shared, names)).to.deep.equal({ id: 'shared', label: 'Shared with me' })
    // (a song with no space, or one the names do not know, is in a place with no name)
    expect(placeOf({ id: 'z' } as SongWithContent, names)).to.deep.equal({ id: '', label: '' })
    expect(placeOf({ id: 'y', spaceId: 'gone' } as SongWithContent, names)).to.deep.equal({
      id: 'gone',
      label: '',
    })
  })

  it('lists the places songs are in, each once, as they come', () => {
    expect(
      placesOf([theirs, own, shared, other, another], names).map(place => place.id)
    ).to.deep.equal(['there', 'here', 'shared', 'other'])
    expect(placesOf([], names)).to.deep.equal([])
  })

  it('leaves out the songs of the places named, and gives back the same list for none', () => {
    const songs = [own, shared, other]
    expect(filterByPlace(songs, [], names)).to.equal(songs)
    expect(filterByPlace(songs, ['shared'], names)).to.deep.equal([own, other])
    expect(filterByPlace(songs, ['here', 'other'], names)).to.deep.equal([shared])
  })

  it('keeps what was left out, and forgets it when nothing is', () => {
    expect(loadLeftOut()).to.deep.equal([])
    saveLeftOut(['x', 'y'])
    expect(loadLeftOut()).to.deep.equal(['x', 'y'])
    saveLeftOut([])
    expect(localStorage.getItem('library-places-left-out')).to.equal(null)
  })

  it('reads nothing from what is stored but a list of ids', () => {
    localStorage.setItem('library-places-left-out', '{"a":1}')
    expect(loadLeftOut()).to.deep.equal([])
    localStorage.setItem('library-places-left-out', '["a", 3, "b"]')
    expect(loadLeftOut()).to.deep.equal(['a', 'b'])
    localStorage.setItem('library-places-left-out', 'not json')
    expect(loadLeftOut()).to.deep.equal([])
  })

  it('works when storage cannot be used', () => {
    const real = Storage.prototype.getItem
    const realSet = Storage.prototype.setItem
    Storage.prototype.getItem = () => {
      throw new Error('blocked')
    }
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(loadLeftOut()).to.deep.equal([])
      saveLeftOut(['x'])
    } finally {
      Storage.prototype.getItem = real
      Storage.prototype.setItem = realSet
    }
  })
})

describe('library-space-filter', () => {
  const here = { id: 'here', label: 'Here' }
  const places = [here, { id: 'shared', label: 'Shared with me' }]
  const buttons = (el: LibrarySpaceFilter) =>
    Array.from(el.shadowRoot?.querySelectorAll('button') ?? [])

  it('draws nothing for one place', async () => {
    const el = await fixture<LibrarySpaceFilter>(
      html`<library-space-filter .places=${[here]}></library-space-filter>`
    )
    expect(buttons(el)).to.have.length(0)
  })

  it('shows a button for each place, pressed unless it is left out', async () => {
    const el = await fixture<LibrarySpaceFilter>(
      html`<library-space-filter .places=${places} .leftOut=${['shared']}></library-space-filter>`
    )
    expect(buttons(el).map(button => button.textContent?.trim())).to.deep.equal([
      'Here',
      'Shared with me',
    ])
    expect(buttons(el).map(button => button.getAttribute('aria-pressed'))).to.deep.equal([
      'true',
      'false',
    ])
  })

  it('says which places are left out once one is switched off, or on again', async () => {
    const el = await fixture<LibrarySpaceFilter>(
      html`<library-space-filter .places=${places} .leftOut=${['shared']}></library-space-filter>`
    )
    const heard: string[][] = []
    el.addEventListener(LeftOutChangeEvent.type, event =>
      heard.push((event as LeftOutChangeEvent).leftOut)
    )
    must(buttons(el)[0]).click()
    must(buttons(el)[1]).click()
    expect(heard).to.deep.equal([['shared', 'here'], []])
  })
})
