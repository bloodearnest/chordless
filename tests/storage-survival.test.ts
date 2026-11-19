/**
 * What the app keeps on a device from one launch to the next (src/js/storage-survival.ts): the
 * check that was made for a Safari web app that was reported to open as a first use every time.
 */
import { expect } from '@open-wc/testing'
import { checkLaunch, type SurvivalEnvironment } from '../src/js/storage-survival.ts'
import { launchAttributes } from '../src/js/telemetry/launch.ts'
import { deleteDatabase } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

/** A localStorage of its own, which a test can "clear" as a browser might */
function fakeStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe('checking what a launch kept', () => {
  let storage = fakeStorage()
  let at = Date.parse('2026-11-01T10:00:00Z')

  const launch = (over: Partial<SurvivalEnvironment> = {}) => {
    at += 3_600_000
    return checkLaunch({
      storage,
      indexedDB,
      now: () => new Date(at),
      persisted: async () => false,
      controlled: () => true,
      cacheCount: async () => 2,
      ...over,
    })
  }

  beforeEach(async () => {
    storage = fakeStorage()
    at = Date.parse('2026-11-01T10:00:00Z')
    await deleteDatabase('chordless-launch')
  })
  afterEach(async () => {
    await deleteDatabase('chordless-launch')
  })

  it('finds nothing at a first launch, and counts it', async () => {
    const report = await launch()
    expect(report.localStorage).to.equal('new')
    expect(report.indexedDb).to.equal('new')
    expect(report.launches).to.equal(1)
    expect(report.previous).to.equal(null)
  })

  it('finds the last launch in both stores at the next, and counts on', async () => {
    const first = await launch()
    const second = await launch()
    expect(second.localStorage).to.equal('kept')
    expect(second.indexedDb).to.equal('kept')
    expect(second.launches).to.equal(2)
    expect(second.firstSeen).to.equal(first.firstSeen)
    expect(second.previous).to.equal(new Date(at - 3_600_000).toISOString())
    expect((await launch()).launches).to.equal(3)
  })

  it('says which store was cleared, and keeps the count from the other', async () => {
    await launch()
    await launch()
    storage.map.clear()
    const report = await launch()
    expect(report.localStorage).to.equal('new')
    expect(report.indexedDb).to.equal('kept')
    expect(report.launches).to.equal(3)
  })

  it('starts again, with a new first day, when both were cleared', async () => {
    await launch()
    storage.map.clear()
    await deleteDatabase('chordless-launch')
    const report = await launch()
    expect(report.localStorage).to.equal('new')
    expect(report.indexedDb).to.equal('new')
    expect(report.launches).to.equal(1)
    expect(report.firstSeen).to.equal(new Date(at).toISOString())
  })

  it('takes a damaged marker for none', async () => {
    storage.setItem('chordless:launch', '{"launches":"many"')
    expect((await launch()).localStorage).to.equal('new')
  })

  it('says a store is unavailable where it cannot be read', async () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    const report = await launch({ storage: blocked, indexedDB: null })
    expect(report.localStorage).to.equal('unavailable')
    expect(report.indexedDb).to.equal('unavailable')
    expect(report.launches).to.equal(1)
  })

  it('reports what the browser says of persistence, the service worker and the caches', async () => {
    const report = await launch({ persisted: async () => null, cacheCount: async () => null })
    expect(report.persisted).to.equal(null)
    expect(report.caches).to.equal(null)
    expect(report.controlled).to.equal(true)
  })
})

describe('the launch report as a span', () => {
  const report = {
    localStorage: 'kept',
    indexedDb: 'new',
    launches: 4,
    firstSeen: '2026-10-30T10:00:00.000Z',
    previous: '2026-11-01T09:00:00.000Z',
    persisted: false,
    controlled: true,
    caches: 3,
  } as const
  const now = new Date('2026-11-01T10:00:00.000Z')

  it('has counts, times and yes or no, and flags a first launch', () => {
    expect(launchAttributes(report, true, now)).to.deep.equal({
      'chordless.storage.local': 'kept',
      'chordless.storage.indexeddb': 'new',
      'chordless.storage.launches': 4,
      'chordless.storage.first_seen_days': 2,
      'chordless.storage.fresh': false,
      'chordless.storage.controlled': true,
      'chordless.storage.previous_s': 3600,
      'chordless.storage.persisted': false,
      'chordless.storage.caches': 3,
      'chordless.storage.signed_in_record': true,
    })
    expect(launchAttributes({ ...report, launches: 1, previous: null }, null, now)).to.include({
      'chordless.storage.fresh': true,
    })
  })

  it('leaves out what is not known', () => {
    const attributes = launchAttributes(
      { ...report, previous: null, persisted: null, caches: null },
      null,
      now
    )
    for (const name of ['previous_s', 'persisted', 'caches', 'signed_in_record']) {
      expect(attributes).to.not.have.property(`chordless.storage.${name}`)
    }
  })
})
