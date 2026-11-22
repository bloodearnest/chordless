import { expect } from '@open-wc/testing'
import { type DataChange, DataChangeEvent } from '../src/js/data-changes.ts'
import { SpaceDataAutoSync } from '../src/js/space-data-runtime.ts'
import { SpaceOutboxChangedEvent } from '../src/js/space-data-store.ts'

const { describe, it } = window

describe('space-data automatic delivery', () => {
  it('also refreshes followed teams when the app resumes', async () => {
    const win = new EventTarget()
    const doc = new EventTarget()
    const sent: string[] = []
    const auto = new SpaceDataAutoSync({
      win,
      doc,
      current: () => 'current',
      visible: () => true,
      followed: async () => ['current', 'other'],
      run: id => sent.push(id),
      every: () => () => {},
    })
    auto.start()
    await Promise.resolve()
    expect(sent).to.deep.equal(['current', 'other'])
    auto.stop()
  })
  it('sends committed edits immediately, including another space and another tab, without a debounce', () => {
    const win = new EventTarget()
    const doc = new EventTarget()
    const sent: string[] = []
    let tick = () => {}
    let visible = true
    let current: string | null = 'current'
    let stopped = false
    const auto = new SpaceDataAutoSync({
      win,
      doc,
      current: () => current,
      visible: () => visible,
      run: id => sent.push(id),
      every: fn => {
        tick = fn
        return () => {
          stopped = true
        }
      },
    })
    auto.start()
    expect(sent).to.deep.equal(['current'])
    win.dispatchEvent(new SpaceOutboxChangedEvent('other'))
    expect(sent).to.deep.equal(['current', 'other'])
    const change: DataChange = {
      spaceId: 'another',
      kind: 'setlist',
      ids: ['service'],
      origin: 'local',
      remote: true,
    }
    win.dispatchEvent(new DataChangeEvent(change))
    expect(sent.at(-1)).to.equal('another')
    const before = sent.length
    win.dispatchEvent(new DataChangeEvent({ ...change, origin: 'sync' }))
    win.dispatchEvent(new DataChangeEvent({ ...change, kind: 'chart' }))
    expect(sent.length).to.equal(before)
    visible = false
    tick()
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(sent.length).to.equal(before)
    win.dispatchEvent(new Event('online'))
    expect(sent.at(-1)).to.equal('current')
    visible = true
    tick()
    doc.dispatchEvent(new Event('visibilitychange'))
    current = null
    tick()
    auto.stop()
    expect(stopped).to.equal(true)
    const after = sent.length
    win.dispatchEvent(new SpaceOutboxChangedEvent('stopped'))
    expect(sent.length).to.equal(after)
  })
})
