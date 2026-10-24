import { expect } from '@open-wc/testing'
import { LitElement } from 'lit'
import { announceDataChange, type DataChange } from '../src/js/data-changes.ts'
import { watchData } from '../src/js/data-watcher.ts'
import { createSpace, deleteSpace, getCurrentSpace, setCurrentSpace } from '../src/js/space.ts'
import { wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

class WatchingElement extends LitElement {
  heard: DataChange[][] = []
  constructor() {
    super()
    watchData(this, ['song', 'chart'], changes => this.heard.push(changes), 20)
  }
}
customElements.define('watching-element', WatchingElement)

describe('DataWatcher', () => {
  let before: { id: string | null; name: string }
  let spaceId: string
  let element: WatchingElement

  beforeEach(async () => {
    before = getCurrentSpace()
    const space = await createSpace(`Watch ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    await setCurrentSpace(space.id, space.name)
    element = document.createElement('watching-element') as WatchingElement
    document.body.append(element)
  })

  afterEach(async () => {
    element.remove()
    await deleteSpace(spaceId)
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  const announce = (kind: 'song' | 'chart' | 'setlist', fields: Partial<DataChange> = {}) =>
    announceDataChange({ spaceId, kind, ids: ['a'], origin: 'sync', ...fields })

  it('is told once, with the changes, when writes of the kinds it shows stop for a moment', async () => {
    announce('song')
    announce('chart', { ids: ['c'] })
    await wait(100)
    expect(element.heard).to.have.length(1)
    expect(element.heard[0].map(change => change.kind)).to.deep.equal(['song', 'chart'])
  })

  it('is not told of other kinds, or of another space', async () => {
    announce('setlist')
    announce('song', { spaceId: 'another-space' })
    await wait(100)
    expect(element.heard).to.have.length(0)
  })

  it('is told of the page’s own writes, and of another tab’s, as of any other', async () => {
    announce('song', { origin: 'local' })
    await wait(100)
    expect(element.heard).to.have.length(1)
  })

  it('stops when the page is left, even for a change heard just before', async () => {
    announce('song')
    element.remove()
    await wait(100)
    announce('song')
    await wait(100)
    expect(element.heard).to.have.length(0)
  })
})
