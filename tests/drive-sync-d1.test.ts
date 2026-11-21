import { expect } from '@open-wc/testing'
import { createSpace, deleteSpace, updateSpace } from '../src/js/space.ts'
import { SpaceDataStore } from '../src/js/space-data-store.ts'
import { SyncManager } from '../src/js/sync-manager.ts'
import { teamApi } from '../src/js/team-client.ts'
import { addSong, useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'

const { describe, it } = window

describe('Drive sync after a Team moves to D1', () => {
  const rig = useSyncRig()

  async function movedDevice() {
    let mode: 'drive' | 'd1' = 'drive'
    const device = await rig.makeDevice('owner', { metadataStorage: async () => mode })
    const setlist = await rig.addSetlist(device, { name: 'Before the move' })
    await device.db.savePeople([
      {
        id: 'ann',
        name: 'Ann',
        emails: [],
        modifiedDate: '2026-11-20T00:00:00Z',
      },
    ])
    await addSong(device, {
      uuid: 'song-a',
      title: 'Song',
      content: '{title: Song}\n[C]Original',
    })
    await rig.syncDevice(device)
    const saved = must(await device.db.getSetlist(setlist.id))
    const person = must(await device.db.getPerson('ann'))
    mode = 'd1'
    await rig.editSetlist(device, setlist.id, { name: 'D1 edit' })
    await device.db.savePeople([{ ...person, name: 'D1 Ann' }])
    rig.storage.clearCalls()
    return {
      device,
      setlist: { ...saved, fileRef: must(saved.fileRef) },
      person: { ...person, fileRef: must(person.fileRef) },
    }
  }

  it('leaves archived setlists and people alone while charts still upload and download', async () => {
    const { device, setlist, person } = await movedDevice()
    rig.storage.edit(setlist.fileRef, JSON.stringify({ ...setlist, name: 'Old Drive edit' }))
    rig.storage.edit(person.fileRef, JSON.stringify({ ...person, name: 'Old Drive Ann' }))
    await addSong(device, {
      uuid: 'song-b',
      title: 'New song',
      content: '{title: New song}\n[G]New',
    })
    await rig.syncDevice(device)
    expect(must(await device.db.getSetlist(setlist.id)).name).to.equal('D1 edit')
    expect(must(await device.db.getPerson('ann')).name).to.equal('D1 Ann')
    expect(JSON.parse(rig.storage.file(setlist.fileRef).content).name).to.equal('Old Drive edit')
    expect(JSON.parse(rig.storage.file(person.fileRef).content).name).to.equal('Old Drive Ann')
    expect(rig.storage.list(file => file.props.songUuid === 'song-b')).to.have.length(1)
    const song = must(await device.db.getSong('song-a'))
    rig.storage.edit(must(song.fileRef), '{title: Song}\n[D]Updated remotely')
    await rig.syncDevice(device)
    expect(must(await device.db.getChordPro(song.chordproFileId)).content).to.contain(
      'Updated remotely'
    )
  })

  it('ignores archived changes and removals in the incremental feed', async () => {
    const { device, setlist, person } = await movedDevice()
    rig.storage.trash(setlist.fileRef)
    rig.storage.trash(person.fileRef)
    await device.sync.incrementalSync()
    expect(must(await device.db.getSetlist(setlist.id)).name).to.equal('D1 edit')
    expect(must(await device.db.getSetlist(setlist.id)).fileRef).to.equal(setlist.fileRef)
    expect(must(await device.db.getPerson('ann')).fileRef).to.equal(person.fileRef)
    expect(
      rig.storage.list(file => Boolean(file.props.setlistId || file.props.personId))
    ).to.have.length(0)
    await device.sync.incrementalSync(null, { push: false })
  })

  it('does not report a pending deletion of an archived setlist as a Drive change', async () => {
    const { device, setlist } = await movedDevice()
    await device.db.removeSetlist(setlist.id)
    expect(
      (await device.sync.findUnsyncedChanges()).some(change => change.id === setlist.fileRef)
    ).to.equal(false)
  })

  it('does not delete unchanged D1 setlists when archived files disappear', async () => {
    const { device, setlist } = await movedDevice()
    await device.db.saveSetlist(setlist)
    rig.storage.trash(setlist.fileRef)
    await rig.syncDevice(device)
    expect(await device.db.getSetlist(setlist.id)).to.deep.equal(setlist)
  })

  it('keeps archived files when deleting locally, and excludes metadata from Drive unsynced warnings', async () => {
    const { device, setlist } = await movedDevice()
    await device.db.removeSetlist(setlist.id)
    const run = device.sync.newRun()
    run.metadataInD1 = true
    expect(await device.sync.trashPendingDeletions(run)).to.equal(0)
    expect((await device.sync.findUnsyncedChanges()).map(change => change.id)).not.to.include(
      setlist.fileRef
    )
    await rig.syncDevice(device)
    expect(rig.storage.file(setlist.fileRef).trashed).to.equal(false)
    expect(await device.db.getPendingDeletions()).to.deep.equal([])
  })

  it('preserves D1 setlists and people when resetting or unlinking Drive content', async () => {
    const { device, setlist, person } = await movedDevice()
    await device.sync.resetLocalFromDrive()
    expect(must(await device.db.getSetlist(setlist.id)).name).to.equal('D1 edit')
    expect(must(await device.db.getPerson('ann')).name).to.equal('D1 Ann')
    expect(await device.db.getSong('song-a')).to.exist
    await device.sync.startOver()
    expect(must(await device.db.getSetlist(setlist.id)).fileRef).to.equal(setlist.fileRef)
    expect(must(await device.db.getPerson('ann')).fileRef).to.equal(person.fileRef)
    expect(must(await device.db.getSong('song-a')).fileRef).to.equal(null)
  })

  it('does not touch Drive metadata when its ownership cannot be checked', async () => {
    const device = await rig.makeDevice('offline-mode-check', {
      metadataStorage: async () => {
        throw new Error('Mode unavailable')
      },
    })
    await rig.addSetlist(device)
    let failure: unknown
    await device.sync.sync().catch(error => {
      failure = error
    })
    expect(String(failure)).to.contain('Mode unavailable')
    expect(rig.storage.list(file => Boolean(file.props.setlistId))).to.have.length(0)
  })
})

describe('detecting where Team metadata lives', () => {
  const rig = useSyncRig()
  for (const role of ['owner', 'reader'] as const) {
    it(`asks the Worker for a ${role} and remembers a move for later runs`, async () => {
      const space = await createSpace(`D1 mode ${crypto.randomUUID()}`)
      const originalRoot = teamApi.root
      try {
        await updateSpace(space.id, { team: { id: 'team-moved', role } })
        const device = await rig.makeDevice('mode')
        let calls = 0
        teamApi.root = async id => {
          expect(id).to.equal('team-moved')
          calls++
          return { ref: id, name: space.name, trashed: false, canWrite: true, storage: 'd1' }
        }
        const manager = await SyncManager.open(space.name, space.id, {
          db: device.db,
          storage: rig.storage,
          folderLink: device.folderLink,
        })
        await manager.init()
        await rig.addSetlist(device)
        await manager.sync()
        await manager.sync()
        expect(calls).to.equal(1)
        expect(rig.driveSetlistFiles()).to.have.length(0)
      } finally {
        teamApi.root = originalRoot
        await deleteSpace(space.id)
      }
    })
  }

  it('uses a confirmed local D1 checkpoint without asking the Worker again', async () => {
    const device = await rig.makeDevice('confirmed')
    await new SpaceDataStore(device.db).apply(
      { songs: [], setlists: [], people: [], padSets: [], from: null },
      'tag'
    )
    await rig.addSetlist(device)
    await device.sync.pushToDrive()
    await device.sync.pullFromDrive()
    expect(rig.driveSetlistFiles()).to.have.length(0)
    expect(await device.sync.hasSyncedRecords()).to.equal(false)
  })
})
