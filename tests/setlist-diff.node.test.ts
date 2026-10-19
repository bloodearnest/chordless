import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SetlistEntry } from '../src/js/data-types.ts'
import { describeSetlistChange } from '../src/js/sync/setlist-diff.ts'
import { makeEntry, makeSetlist } from './builders.ts'

const song = (id: string, overrides: Partial<SetlistEntry> = {}) =>
  makeEntry({ songId: id, songUuid: `uuid-${id}`, key: 'G', tempo: 90, ...overrides })
const titleOf = (entry: SetlistEntry) => entry.songId.toUpperCase()
const setlist = (songs: SetlistEntry[], overrides = {}) => makeSetlist({ songs, ...overrides })
const describe_ = (before: ReturnType<typeof setlist>, after: ReturnType<typeof setlist>) =>
  describeSetlistChange(before, after, titleOf)

describe('describing what a setlist changed', () => {
  it('is empty for the same setlist', () => {
    const same = setlist([song('a'), song('b')])
    assert.deepEqual(describe_(same, setlist([song('a'), song('b')])), [])
  })

  it('names the songs added and removed', () => {
    assert.deepEqual(describe_(setlist([song('a'), song('b')]), setlist([song('a'), song('c')])), [
      '+ C',
      '− B',
    ])
  })

  it('says when the order changed, but not for an added song alone', () => {
    assert.deepEqual(describe_(setlist([song('a'), song('b')]), setlist([song('b'), song('a')])), [
      'order changed',
    ])
    assert.deepEqual(
      describe_(setlist([song('a'), song('b')]), setlist([song('c'), song('a'), song('b')])),
      ['+ C']
    )
  })

  it('says a key or a tempo that is different, with the song’s title', () => {
    assert.deepEqual(
      describe_(
        setlist([song('a', { key: 'G', tempo: 90 }), song('b', { key: null, tempo: null })]),
        setlist([song('a', { key: 'A', tempo: 100 }), song('b', { key: 'D', tempo: null })])
      ),
      ['A: key G → A', 'A: 90 → 100 BPM', 'B: key — → D']
    )
  })

  it('says the details changed (date, time, type, name, leader)', () => {
    assert.deepEqual(
      describe_(setlist([song('a')]), setlist([song('a')], { date: '2030-01-01' })),
      ['details changed']
    )
  })

  it('takes a different chart of the same song for the same song', () => {
    assert.deepEqual(
      describe_(setlist([song('a')]), setlist([song('a', { songUuid: 'another-chart' })])),
      []
    )
  })

  it('takes a missing key, tempo or detail for an empty one', () => {
    const bare = (extra: Partial<SetlistEntry>) =>
      ({ ...song('a'), key: undefined, tempo: undefined, ...extra }) as unknown as SetlistEntry
    assert.deepEqual(
      describe_(setlist([bare({})]), setlist([bare({ key: null, tempo: null })])),
      []
    )
    assert.deepEqual(describe_(setlist([bare({})]), setlist([bare({ key: 'A', tempo: 80 })])), [
      'A: key — → A',
      'A: — → 80 BPM',
    ])
    assert.deepEqual(
      describe_(
        setlist([bare({ key: 'G', tempo: 90 })]),
        setlist([bare({ key: null, tempo: null })])
      ),
      ['A: key G → —', 'A: 90 → — BPM']
    )
    const noName = { ...setlist([]), name: undefined } as unknown as ReturnType<typeof setlist>
    assert.deepEqual(describe_(noName, setlist([], { name: '' })), [])
    assert.deepEqual(describe_(setlist([], { name: '' }), noName), [])
  })
})
