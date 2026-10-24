import { expect } from '@open-wc/testing'
import {
  announceDataChange,
  type DataChange,
  DataChangeEvent,
  listenForOtherTabs,
  touches,
} from '../src/js/data-changes.ts'
import { wait } from './test-helpers.ts'

const { describe, it } = window

const change = (fields: Partial<DataChange> = {}): DataChange => ({
  spaceId: 'space',
  kind: 'setlist',
  ids: ['a'],
  origin: 'local',
  remote: false,
  ...fields,
})

describe('touches', () => {
  it('is whether a change is of the kind, and of the record if one is asked about', () => {
    expect(touches(change(), 'setlist')).to.equal(true)
    expect(touches(change(), 'song')).to.equal(false)
    expect(touches(change(), 'setlist', 'a')).to.equal(true)
    expect(touches(change(), 'setlist', 'b')).to.equal(false)
  })

  it('takes a change of all of the kind to touch every record of it', () => {
    expect(touches(change({ ids: null }), 'setlist', 'anything')).to.equal(true)
    expect(touches(change({ ids: null }), 'song', 'anything')).to.equal(false)
  })
})

describe('announcing a change', () => {
  it('sends it on the window, as made here', async () => {
    const seen: DataChange[] = []
    const listener = (event: DataChangeEvent) => seen.push(event.change)
    window.addEventListener(DataChangeEvent.type, listener)
    announceDataChange({ spaceId: 'space', kind: 'song', ids: ['s'], origin: 'sync' })
    window.removeEventListener(DataChangeEvent.type, listener)
    expect(seen).to.deep.equal([
      { spaceId: 'space', kind: 'song', ids: ['s'], origin: 'sync', remote: false },
    ])
  })

  it('does not come back to the page that made it as a change from another tab', async () => {
    listenForOtherTabs()
    const seen: DataChange[] = []
    const listener = (event: DataChangeEvent) => seen.push(event.change)
    window.addEventListener(DataChangeEvent.type, listener)
    announceDataChange({ spaceId: 'space', kind: 'song', ids: ['s'], origin: 'local' })
    await wait(100)
    window.removeEventListener(DataChangeEvent.type, listener)
    expect(seen.map(change => change.remote)).to.deep.equal([false])
  })

  it('reaches another tab as a change that is remote, and is not heard twice here', async () => {
    listenForOtherTabs()
    const seen: DataChange[] = []
    const listener = (event: DataChangeEvent) => seen.push(event.change)
    window.addEventListener(DataChangeEvent.type, listener)
    // (another tab's own channel: what it sends is heard by this page's listener)
    const other = new BroadcastChannel('chordless-data-changes')
    other.postMessage({
      tab: 'another-tab',
      change: { spaceId: 'space', kind: 'chart', ids: ['c'], origin: 'local' },
    })
    other.postMessage('not a change')
    other.postMessage(null)
    await wait(100)
    other.close()
    window.removeEventListener(DataChangeEvent.type, listener)
    expect(seen).to.deep.equal([
      { spaceId: 'space', kind: 'chart', ids: ['c'], origin: 'local', remote: true },
    ])
  })
})
