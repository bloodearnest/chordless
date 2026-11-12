/**
 * A setlist changed on two devices (docs/SYNC_ARCHITECTURE.md, "When both sides changed a
 * setlist"): the leader's version is the base and the other adds its new songs and annotations,
 * whichever device pulls it. The pure merge is in setlist-merge.node.test.ts; this is the sync
 * using it.
 */
import { expect } from '@open-wc/testing'
import type { Person, SharedChartAnnotation } from '../src/js/data-types.ts'
import { makeEntry } from './builders.ts'
import { useSyncRig } from './drive-harness.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

const ann: Person = {
  id: 'ann',
  name: 'Ann',
  emails: ['ann@example.com'],
  modifiedDate: '2026-10-11T10:00:00.000Z',
}
const entry = (songId: string, extra: Record<string, unknown> = {}) =>
  makeEntry({ songId, songUuid: `u-${songId}`, ...extra })
const note = (id: string, text: string): SharedChartAnnotation => ({
  id,
  anchor: { kind: 'song' } as SharedChartAnnotation['anchor'],
  body: { kind: 'text', text },
  modified: '2026-10-11T10:00:00.000Z',
})
const withOrder = (...entries: ReturnType<typeof entry>[]) =>
  entries.map((each, order) => ({ ...each, order }))

describe('Drive sync: a setlist changed on two devices', () => {
  const rig = useSyncRig()
  const { makeDevice, addSetlist, editSetlist, syncDevice, driveSetlist } = rig

  /** Ann (the leader) on one device and Bob on the other, both with the setlist, as last synced */
  async function twoDevices() {
    const leader = await makeDevice('leader', {
      identity: async () => ({ email: 'ann@example.com', chosenPersonId: null }),
    })
    const other = await makeDevice('other', {
      identity: async () => ({ email: 'bob@example.com', chosenPersonId: null }),
    })
    await leader.db.savePeople([ann])
    const set = await addSetlist(leader, {
      leaderId: 'ann',
      songs: withOrder(entry('a', { key: 'C' }), entry('b')),
    })
    await syncDevice(leader)
    await syncDevice(other)
    return { leader, other, id: set.id }
  }

  const songsOf = async (
    device: { db: { getSetlist: (id: string) => Promise<unknown> } },
    id: string
  ) =>
    (must(await device.db.getSetlist(id)) as { songs: { songId: string; key: string | null }[] })
      .songs

  it('has a writer’s changes meet the leader’s: the leader’s keys and order, the writer’s new songs and notes', async () => {
    const { leader, other, id } = await twoDevices()

    // The leader changes a key and adds a song, and sends it
    await editSetlist(leader, id, {
      songs: withOrder(entry('a', { key: 'G' }), entry('b'), entry('c')),
    })
    await syncDevice(leader)
    // The other writer, not having seen that, changes the key, adds a song and a note
    await editSetlist(other, id, {
      songs: withOrder(
        entry('a', { key: 'D' }),
        entry('b', { annotations: [note('n1', 'repeat 4 times')] }),
        entry('x')
      ),
    })
    const report = await syncDevice(other)

    const songs = await songsOf(other, id)
    expect(songs.find(each => each.songId === 'a')?.key).to.equal('G')
    expect(songs.map(each => each.songId)).to.have.members(['a', 'b', 'c', 'x'])
    expect(report.resetSetlists).to.have.length(1)
    expect(report.resetSetlists[0].how).to.equal('merged')

    // What was merged is sent: Drive has the leader's key and the other’s additions
    const inDrive = driveSetlist(id)
    expect(inDrive.songs.map((each: { songId: string }) => each.songId)).to.have.members([
      'a',
      'b',
      'c',
      'x',
    ])
    expect(inDrive.songs.find((each: { songId: string }) => each.songId === 'a').key).to.equal('G')
    expect(
      inDrive.songs.find((each: { songId: string }) => each.songId === 'b').annotations[0].body.text
    ).to.equal('repeat 4 times')
  })

  it('has the leader’s device keep its own version when it is the one behind, and take the writer’s additions', async () => {
    const { leader, other, id } = await twoDevices()

    // The writer sends a new song and a note first
    await editSetlist(other, id, {
      songs: withOrder(
        entry('a', { key: 'D' }),
        entry('b', { annotations: [note('n1', 'drop out')] }),
        entry('x')
      ),
    })
    await syncDevice(other)
    // The leader had changed a key and removed a song, not having seen it
    await editSetlist(leader, id, { songs: withOrder(entry('a', { key: 'G' })) })
    const report = await syncDevice(leader)

    const songs = await songsOf(leader, id)
    expect(songs.find(each => each.songId === 'a')?.key).to.equal('G')
    // (the leader's removal of b stands; the writer's new song comes in; the note was on b)
    expect(songs.map(each => each.songId)).to.deep.equal(['a', 'x'])
    expect(report.resetSetlists[0].how).to.equal('kept')
    expect(driveSetlist(id).songs.map((each: { songId: string }) => each.songId)).to.deep.equal([
      'a',
      'x',
    ])
  })

  it('takes the shared version as the base on a device that is not signed in (it cannot be the leader)', async () => {
    const one = await makeDevice('one')
    const two = await makeDevice('two')
    await one.db.savePeople([ann])
    const set = await addSetlist(one, {
      leaderId: 'ann',
      songs: withOrder(entry('a', { key: 'C' })),
    })
    await syncDevice(one)
    await syncDevice(two)
    await editSetlist(one, set.id, { songs: withOrder(entry('a', { key: 'G' })) })
    await syncDevice(one)
    await editSetlist(two, set.id, { songs: withOrder(entry('a', { key: 'D' }), entry('x')) })
    const report = await syncDevice(two)
    const songs = await songsOf(two, set.id)
    expect(songs.map(each => each.songId)).to.deep.equal(['a', 'x'])
    expect(songs[0].key).to.equal('G')
    expect(report.resetSetlists[0].how).to.equal('merged')
  })

  it('knows the leader by the signed-in account on a device that is not told who is using it', async () => {
    const auth = installFakeAuthWorker()
    try {
      auth.worker.stored = {
        blob: 'blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          user: {
            name: 'Ann',
            email: 'ann@example.com',
            picture: null,
            given_name: null,
            family_name: null,
            sub: '1',
          },
        },
        updated_at: new Date().toISOString(),
      }
      const one = await makeDevice('one')
      const two = await makeDevice('two')
      await one.db.savePeople([ann])
      const set = await addSetlist(one, {
        leaderId: 'ann',
        songs: withOrder(entry('a', { key: 'C' })),
      })
      await syncDevice(one)
      await syncDevice(two)
      await editSetlist(two, set.id, { songs: withOrder(entry('a', { key: 'D' })) })
      await syncDevice(two)
      await editSetlist(one, set.id, { songs: withOrder(entry('a', { key: 'G' })) })
      const report = await syncDevice(one)
      // (Ann is signed in, and leads it: hers stays)
      expect((await songsOf(one, set.id))[0].key).to.equal('G')
      expect(report.resetSetlists[0].how).to.equal('kept')
    } finally {
      auth.uninstall()
    }
  })

  it('settles nothing when the file changed but its content did not, and keeps the changes made here', async () => {
    const { leader, id } = await twoDevices()
    await editSetlist(leader, id, { songs: withOrder(entry('a', { key: 'G' }), entry('b')) })
    // (the file is written again by something else, the same setlist in other words: a new rev)
    const file = rig.driveSetlistFiles()[0]
    rig.storage.edit(file.ref, JSON.stringify(JSON.parse(file.content)))
    const report = await syncDevice(leader)
    expect(report.resetSetlists).to.deep.equal([])
    expect((await songsOf(leader, id))[0].key).to.equal('G')
    expect(driveSetlist(id).songs[0].key).to.equal('G')
  })

  it('has a writer who is nobody’s leader take the shared version, as before, when they changed nothing it lacks', async () => {
    const { leader, other, id } = await twoDevices()
    await editSetlist(leader, id, { songs: withOrder(entry('a', { key: 'G' }), entry('b')) })
    await syncDevice(leader)
    await editSetlist(other, id, { songs: withOrder(entry('a', { key: 'D' }), entry('b')) })
    const report = await syncDevice(other)
    expect((await songsOf(other, id))[0].key).to.equal('G')
    expect(report.resetSetlists[0].how).to.equal('replaced')
    expect(driveSetlist(id).songs[0].key).to.equal('G')
  })
})
