import { expect } from '@open-wc/testing'
import { type DataChange, DataChangeEvent } from '../src/js/data-changes.ts'
import {
  BackgroundSyncFailures,
  isNetworkFailure,
  NETWORK_FAILURES_BEFORE_TOAST,
  NETWORK_FAILURES_SPAN_MS,
  SpaceDataAutoSync,
} from '../src/js/space-data-runtime.ts'
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
    win.dispatchEvent(new DataChangeEvent({ ...change, kind: 'score' }))
    expect(sent.length).to.equal(before + 2)
    const afterLocalChanges = sent.length
    visible = false
    tick()
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(sent.length).to.equal(afterLocalChanges)
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

describe('which background sync failures are told', () => {
  const unreachable = () => new TypeError('Failed to fetch')

  it('knows a request that did not reach the server, in each browser', () => {
    for (const message of [
      'Failed to fetch',
      'Load failed',
      'NetworkError when attempting to fetch resource.',
    ])
      expect(isNetworkFailure(new TypeError(message)), message).to.equal(true)
    expect(isNetworkFailure(new Error('Failed to fetch'))).to.equal(false)
    expect(isNetworkFailure(new TypeError('x is not a function'))).to.equal(false)
  })

  it('tells of an unreachable server only when it keeps happening for a while, and once', () => {
    let now = 0
    const failures = new BackgroundSyncFailures(() => now)
    for (let i = 1; i < NETWORK_FAILURES_BEFORE_TOAST; i++)
      expect(failures.failed('a', unreachable())).to.equal(null)
    // (many failures in a moment, as a page waking up on a phone has: not yet)
    expect(failures.failed('a', unreachable())).to.equal(null)
    now = NETWORK_FAILURES_SPAN_MS
    expect(failures.failed('a', unreachable())).to.equal('Failed to fetch')
    expect(failures.failed('a', unreachable())).to.equal(null)
  })

  it('starts counting again after a sync works', () => {
    const failures = new BackgroundSyncFailures()
    failures.failed('a', unreachable())
    failures.failed('a', unreachable())
    failures.succeeded('a')
    expect(failures.failed('a', unreachable())).to.equal(null)
    expect(failures.failed('a', unreachable())).to.equal(null)
  })

  it('counts each space on its own', () => {
    const failures = new BackgroundSyncFailures()
    failures.failed('a', unreachable())
    failures.failed('a', unreachable())
    expect(failures.failed('b', unreachable())).to.equal(null)
  })

  it('tells of any other failure at once, and again only for a different reason', () => {
    const failures = new BackgroundSyncFailures()
    expect(failures.failed('a', new Error('Invalid space write response'))).to.equal(
      'Invalid space write response'
    )
    expect(failures.failed('a', new Error('Invalid space write response'))).to.equal(null)
    expect(failures.failed('a', new Error('Something else'))).to.equal('Something else')
    failures.succeeded('a')
    expect(failures.failed('a', new Error('Something else'))).to.equal('Something else')
  })
})
