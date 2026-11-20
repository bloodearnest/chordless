import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Person, Setlist, SetlistEntry } from '../src/js/data-types.ts'
import { controlsSetlist, leadsSetlist } from '../src/js/setlist-control.ts'
import { setlistContent, setlistContentHash, withLocalSongs } from '../src/js/sync/setlist-hash.ts'
import { mayChangeSetlist } from '../src/js/team-roles.ts'

const NOW = '2026-11-14T10:00:00.000Z'
const ann: Person = { id: 'ann', name: 'Ann', emails: ['ann@example.com'], modifiedDate: NOW }
const bob: Person = { id: 'bob', name: 'Bob', emails: ['bob@example.com'], modifiedDate: NOW }
const people = [ann, bob]
const setlist = (over: Partial<Setlist> = {}) => ({
  id: 's1',
  leaderId: 'bob',
  createdBy: 'ann@example.com',
  ...over,
})
const team = (role: 'owner' | 'admin' | 'writer' | 'reader') =>
  ({ team: { role } }) as Parameters<typeof controlsSetlist>[1]
const me = { email: 'ann@example.com', chosenPersonId: null }

describe('mayChangeSetlist', () => {
  it('is for everyone in a personal space, and admins and owners in a team', () => {
    assert.equal(mayChangeSetlist(null, false), true)
    assert.equal(mayChangeSetlist('owner', false), true)
    assert.equal(mayChangeSetlist('admin', false), true)
  })
  it('is a worship leader’s for what they lead or made, and a team member’s for nothing', () => {
    assert.equal(mayChangeSetlist('writer', false), false)
    assert.equal(mayChangeSetlist('writer', true), true)
    assert.equal(mayChangeSetlist('writer', false, true), true)
    assert.equal(mayChangeSetlist('reader', true), false)
    assert.equal(mayChangeSetlist('reader', false, true), false)
  })
})

describe('leadsSetlist', () => {
  it('knows the leader by address or by the person chosen', () => {
    assert.equal(leadsSetlist({ leaderId: 'ann' }, people, me), true)
    assert.equal(leadsSetlist({ leaderId: 'bob' }, people, me), false)
    assert.equal(
      leadsSetlist({ leaderId: 'bob' }, people, { email: null, chosenPersonId: 'bob' }),
      true
    )
    assert.equal(leadsSetlist({ leaderId: undefined }, people, me), false)
    assert.equal(
      leadsSetlist({ leaderId: 'ann' }, people, { email: null, chosenPersonId: null }),
      false
    )
  })
})

describe('controlsSetlist', () => {
  it('is always yours in a personal space', () => {
    assert.equal(controlsSetlist(setlist(), undefined, people, me), true)
    assert.equal(controlsSetlist(setlist(), {} as never, people, me), true)
  })
  it('follows the role in a team', () => {
    assert.equal(controlsSetlist(setlist(), team('admin'), people, me), true)
    assert.equal(controlsSetlist(setlist(), team('writer'), people, me), false)
    assert.equal(controlsSetlist(setlist({ leaderId: 'ann' }), team('writer'), people, me), true)
    assert.equal(controlsSetlist(setlist({ leaderId: 'ann' }), team('reader'), people, me), false)
  })
  it('falls back to the creator when the leader cannot be found, and only then', () => {
    assert.equal(
      controlsSetlist(setlist({ leaderId: undefined }), team('writer'), people, me),
      true
    )
    assert.equal(controlsSetlist(setlist({ leaderId: 'gone' }), team('writer'), people, me), true)
    assert.equal(
      controlsSetlist(setlist({ leaderId: undefined }), team('writer'), people, {
        email: 'cat@example.com',
        chosenPersonId: null,
      }),
      false
    )
    assert.equal(
      controlsSetlist(setlist({ leaderId: undefined }), team('reader'), people, me),
      false
    )
  })
})

describe('songs added for this device alone', () => {
  const entry = (songId: string, local = false): SetlistEntry =>
    ({
      order: 0,
      songId,
      songUuid: songId,
      key: 'G',
      tempo: 100,
      notes: '',
      ...(local ? { local: true } : {}),
    }) as SetlistEntry
  const full = (songs: SetlistEntry[]) =>
    ({
      id: 's1',
      title: 'x',
      songs: songs.map((each, order) => ({ ...each, order })),
    }) as unknown as Setlist

  it('are not in what is stored in Drive, and do not change its hash', () => {
    const shared = full([entry('a'), entry('b')])
    const mine = full([entry('a'), entry('x', true), entry('b')])
    assert.deepEqual(
      setlistContent(mine).songs.map(each => [each.songId, each.order]),
      [
        ['a', 0],
        ['b', 1],
      ]
    )
    assert.equal(setlistContentHash(mine), setlistContentHash(shared))
  })

  it('keep D1 bookkeeping out of Drive content and its hash', () => {
    const shared = full([entry('a')])
    const synced = {
      ...shared,
      version: 2,
      spaceDataBody: { future: true },
      songs: shared.songs.map(song => ({ ...song, spaceDataExtra: { future: true } })),
    }
    assert.deepEqual(setlistContent(synced), shared)
    assert.equal(setlistContentHash(synced), setlistContentHash(shared))
    assert.deepEqual(synced.songs[0].spaceDataExtra, { future: true })
  })

  it('are put back after the song they followed, or last', () => {
    const local = full([entry('a'), entry('x', true), entry('b'), entry('y', true)]).songs
    const merged = withLocalSongs(full([entry('a'), entry('c'), entry('b')]).songs, local)
    assert.deepEqual(
      merged.map(each => each.songId),
      ['a', 'x', 'c', 'b', 'y']
    )
    assert.deepEqual(
      merged.map(each => each.order),
      [0, 1, 2, 3, 4]
    )
    const without = withLocalSongs(full([entry('c')]).songs, local)
    assert.deepEqual(
      without.map(each => each.songId),
      ['c', 'x', 'y']
    )
  })

  it('are put back last when nothing is before them', () => {
    const local = full([entry('x', true), entry('a')]).songs
    const merged = withLocalSongs(full([entry('a')]).songs, local)
    assert.deepEqual(
      merged.map(each => each.songId),
      ['a', 'x']
    )
  })

  it('give way to the same song when the leader adds it too, and change nothing when there are none', () => {
    const remote = full([entry('a'), entry('x')]).songs
    const merged = withLocalSongs(remote, full([entry('a'), entry('x', true)]).songs)
    assert.deepEqual(
      merged.map(each => each.songId),
      ['a', 'x']
    )
    assert.equal(withLocalSongs(remote, undefined), remote)
    assert.equal(withLocalSongs(remote, full([entry('a')]).songs), remote)
  })
})
