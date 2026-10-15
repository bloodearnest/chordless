import { expect } from '@open-wc/testing'
import type { Route } from '../src/js/router.ts'
import { ROUTE_NAMES } from '../src/js/router.ts'
import { views } from '../src/js/views/registry.ts'

const { describe, it } = window

describe('the views of the app shell', () => {
  it('has a view for each route, and no others', () => {
    expect(Object.keys(views).sort()).to.deep.equal([...ROUTE_NAMES].sort())
  })

  it('makes the element for a route by loading its module', async () => {
    const tags: Record<string, string> = {}
    for (const name of ROUTE_NAMES) {
      const element = await views[name].load({ name } as Route)
      tags[name] = element.localName
      expect(customElements.get(element.localName), name).to.be.ok
    }
    expect(tags.setlist).to.equal('setlist-view')
    expect(tags.songs).to.equal('library-view')
    expect(tags['not-found']).to.equal('not-found-view')
  })

  it('titles each page, except the home page, which is the app’s own', () => {
    for (const name of ROUTE_NAMES) {
      const title = views[name].title?.({ name } as Route)
      if (name === 'home') expect(title).to.equal(undefined)
      else expect(title, name).to.match(/ - Chordless$/)
    }
  })

  it('keeps the setlist view for moves within a setlist, and not to another', () => {
    const setlist = (setlistId: string, songIndex = -1) =>
      ({ name: 'setlist', setlistId, songIndex }) as Route
    const same = views.setlist.sameView
    expect(same?.(setlist('a'), setlist('a', 2))).to.equal(true)
    expect(same?.(setlist('a'), setlist('b'))).to.equal(false)
    expect(same?.({ name: 'home' }, setlist('a'))).to.equal(false)
    expect(same?.(setlist('a'), { name: 'home' })).to.equal(false)
  })

  it('keeps the shared setlist view for moves within a share, and not to another', () => {
    const share = (fileId: string, songIndex = -1) =>
      ({ name: 'share', fileId, songIndex }) as Route
    const same = views.share.sameView
    expect(same?.(share('a'), share('a', 2))).to.equal(true)
    expect(same?.(share('a'), share('b'))).to.equal(false)
    expect(same?.({ name: 'home' }, share('a'))).to.equal(false)
    expect(same?.(share('a'), { name: 'home' })).to.equal(false)
  })
})
