import { expect } from '@open-wc/testing'
import { getLive, goLive, isLiveSetlist, LiveChangeEvent, leaveLive } from '../src/js/live.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const KEY = 'live_state'

/** What a call sends on window */
function heard(call: () => void): LiveChangeEvent['live'][] {
  const lives: LiveChangeEvent['live'][] = []
  const listener = (event: LiveChangeEvent) => lives.push(event.live)
  window.addEventListener(LiveChangeEvent.type, listener)
  try {
    call()
  } finally {
    window.removeEventListener(LiveChangeEvent.type, listener)
  }
  return lives
}

describe('live mode state', () => {
  beforeEach(() => localStorage.removeItem(KEY))
  afterEach(() => localStorage.removeItem(KEY))

  it('is not live until a setlist goes live', () => {
    expect(getLive()).to.equal(null)
  })

  it('keeps the live setlist, and says so on window', () => {
    const lives = heard(() => goLive('/setlist/sunday', 'Sunday AM', 1000))
    expect(lives).to.deep.equal([{ url: '/setlist/sunday', title: 'Sunday AM', startedAt: 1000 }])
    expect(getLive()).to.deep.equal(lives[0])
  })

  it('goes live now, unless told when', () => {
    const before = Date.now()
    const live = goLive('/setlist/a', 'A')
    expect(live.startedAt).to.be.within(before, Date.now())
  })

  it('goes to the last setlist that went live', () => {
    goLive('/setlist/a', 'A')
    goLive('/setlist/b', 'B')
    expect(getLive()?.url).to.equal('/setlist/b')
  })

  it('stays live until it is left, which is said on window', () => {
    goLive('/setlist/a', 'A')
    expect(heard(() => leaveLive())).to.deep.equal([null])
    expect(getLive()).to.equal(null)
  })

  it('ignores a record it did not write', () => {
    for (const stored of [
      'not json',
      'null',
      '{}',
      '{"url":"https://elsewhere.example/","title":"x","startedAt":1}',
      '{"url":"/setlist/a","title":3,"startedAt":1}',
      '{"url":"/setlist/a","title":"A","startedAt":"now"}',
    ]) {
      localStorage.setItem(KEY, stored)
      expect(getLive(), stored).to.equal(null)
    }
  })

  it('carries on when storage is blocked', () => {
    const original = Storage.prototype.setItem
    const originalGet = Storage.prototype.getItem
    const originalRemove = Storage.prototype.removeItem
    const refuse = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    Storage.prototype.setItem = refuse
    Storage.prototype.getItem = refuse
    Storage.prototype.removeItem = refuse
    try {
      expect(heard(() => goLive('/setlist/a', 'A', 1))).to.have.length(1)
      expect(heard(() => leaveLive())).to.deep.equal([null])
      expect(getLive()).to.equal(null)
    } finally {
      Storage.prototype.setItem = original
      Storage.prototype.getItem = originalGet
      Storage.prototype.removeItem = originalRemove
    }
  })

  it('hears another window go live or leave', () => {
    localStorage.setItem(KEY, JSON.stringify({ url: '/setlist/a', title: 'A', startedAt: 5 }))
    const lives = heard(() => window.dispatchEvent(new StorageEvent('storage', { key: KEY })))
    expect(lives).to.deep.equal([{ url: '/setlist/a', title: 'A', startedAt: 5 }])
    // Storage cleared altogether (key null), and some other key
    localStorage.removeItem(KEY)
    expect(
      heard(() => window.dispatchEvent(new StorageEvent('storage', { key: null })))
    ).to.deep.equal([null])
    expect(
      heard(() => window.dispatchEvent(new StorageEvent('storage', { key: 'other' })))
    ).to.deep.equal([])
  })

  describe('isLiveSetlist', () => {
    const live = { url: '/setlist/a', title: 'A', startedAt: 1 }
    it('is the setlist, its overview and each of its songs', () => {
      expect(isLiveSetlist(live, '/setlist/a')).to.equal(true)
      expect(isLiveSetlist(live, '/setlist/a/song/3')).to.equal(true)
    })
    it('is not another setlist, or when not live', () => {
      expect(isLiveSetlist(live, '/setlist/b')).to.equal(false)
      expect(isLiveSetlist(null, '/setlist/a')).to.equal(false)
    })
    it("is a share's path, whatever its fragment", () => {
      const share = { url: '/s/file1#key=abc', title: 'S', startedAt: 1 }
      expect(isLiveSetlist(share, '/s/file1/song/2')).to.equal(true)
      expect(isLiveSetlist(share, '/s/file2')).to.equal(false)
    })
  })
})
