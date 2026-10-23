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

const here = { id: 'here', label: 'Here' }
const own = { id: 'a' } as SongWithContent
const shared = { id: 'b', source: { dbId: 'shared', label: 'Shared with me' } } as SongWithContent
const other = { id: 'c', source: { dbId: 'other', label: 'Other' } } as SongWithContent
const another = { id: 'd', source: { dbId: 'other', label: 'Other' } } as SongWithContent

describe('library places', () => {
  afterEach(() => localStorage.removeItem('library-places-left-out'))

  it('puts a song in its own database, or the current space', () => {
    expect(placeOf(own, here)).to.deep.equal(here)
    expect(placeOf(shared, here)).to.deep.equal({ id: 'shared', label: 'Shared with me' })
  })

  it('lists the places songs are in, the current space first, each once', () => {
    expect(placesOf([shared, other, another], here).map(place => place.id)).to.deep.equal([
      'here',
      'shared',
      'other',
    ])
    expect(placesOf([], here)).to.deep.equal([here])
  })

  it('leaves out the songs of the places named, and gives back the same list for none', () => {
    const songs = [own, shared, other]
    expect(filterByPlace(songs, [], here)).to.equal(songs)
    expect(filterByPlace(songs, ['shared'], here)).to.deep.equal([own, other])
    expect(filterByPlace(songs, ['here', 'other'], here)).to.deep.equal([shared])
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
