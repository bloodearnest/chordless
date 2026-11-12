/**
 * Deleting a setlist that is in Drive (docs/SYNC_ARCHITECTURE.md, "Deleting setlists"): its file
 * goes to the Drive trash at the next sync and is not pulled again, another device drops its
 * unchanged copy and keeps one it has edited, a trash that fails is tried again, and a setlist
 * put back comes back.
 */
import { expect } from '@open-wc/testing'
import { useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('Drive sync: deleting a setlist', () => {
  const rig = useSyncRig()
  const { makeDevice, addSetlist, editSetlist, syncDevice, driveSetlistFiles } = rig

  it('puts its file in the Drive trash at the next sync, and does not bring it back', async () => {
    const phone = await makeDevice('phone')
    const keep = await addSetlist(phone, { name: 'Keep' })
    const drop = await addSetlist(phone, { name: 'Drop' })
    await syncDevice(phone)
    const ref = must(must(await phone.db.getSetlist(drop.id)).fileRef)

    await phone.db.removeSetlist(drop.id)
    expect(await phone.db.getSetlist(drop.id)).to.equal(undefined)
    expect((await phone.db.getPendingDeletions()).map(entry => entry.ref)).to.deep.equal([ref])

    await syncDevice(phone)
    expect(rig.storage.file(ref).trashed).to.equal(true)
    expect(driveSetlistFiles()).to.have.length(1)
    expect(await phone.db.getSetlist(drop.id)).to.equal(undefined)
    expect(await phone.db.getSetlist(keep.id)).to.not.equal(undefined)
    expect(await phone.db.getPendingDeletions()).to.deep.equal([])
  })

  it('is no pending deletion when the setlist never reached Drive', async () => {
    const phone = await makeDevice('phone')
    const set = await addSetlist(phone, { name: 'New' })
    await phone.db.removeSetlist(set.id)
    expect(await phone.db.getPendingDeletions()).to.deep.equal([])
    await syncDevice(phone)
    expect(driveSetlistFiles()).to.have.length(0)
  })

  it('is carried out on another device, which drops its unchanged copy', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    const drop = await addSetlist(phone, { name: 'Drop' })
    await syncDevice(phone)
    await syncDevice(tablet)
    expect(await tablet.db.getSetlist(drop.id)).to.not.equal(undefined)

    await phone.db.removeSetlist(drop.id)
    await syncDevice(phone)
    await syncDevice(tablet)

    expect(await tablet.db.getSetlist(drop.id)).to.equal(undefined)
    expect(driveSetlistFiles()).to.have.length(0)
  })

  it('does not take a setlist from a device that has changed it since: that goes back to Drive', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    const drop = await addSetlist(phone, { name: 'Drop' })
    await syncDevice(phone)
    await syncDevice(tablet)
    await editSetlist(tablet, drop.id, { name: 'Edited on the tablet' })

    await phone.db.removeSetlist(drop.id)
    await syncDevice(phone)
    await syncDevice(tablet)

    expect(must(await tablet.db.getSetlist(drop.id)).name).to.equal('Edited on the tablet')
    expect(driveSetlistFiles()).to.have.length(1)
  })

  it('is kept to try again, and the setlist stays gone, when the file cannot be trashed yet', async () => {
    const phone = await makeDevice('phone')
    const drop = await addSetlist(phone, { name: 'Drop' })
    await syncDevice(phone)
    const ref = must(must(await phone.db.getSetlist(drop.id)).fileRef)
    await phone.db.removeSetlist(drop.id)

    rig.storage.fail('trash', { times: 1 })
    await syncDevice(phone)
    expect(rig.storage.file(ref).trashed).to.equal(false)
    expect(await phone.db.getSetlist(drop.id)).to.equal(undefined)
    expect((await phone.db.getPendingDeletions()).length).to.equal(1)

    await syncDevice(phone)
    expect(rig.storage.file(ref).trashed).to.equal(true)
    expect(await phone.db.getPendingDeletions()).to.deep.equal([])
    expect(await phone.db.getSetlist(drop.id)).to.equal(undefined)
  })

  it('is called off by Undo before the file is in the trash: the setlist is as it was, one file', async () => {
    const phone = await makeDevice('phone')
    const drop = await addSetlist(phone, { name: 'Drop' })
    await syncDevice(phone)
    const removed = must(await phone.db.removeSetlist(drop.id))

    await phone.db.restoreSetlist(removed)
    await syncDevice(phone)

    expect(must(await phone.db.getSetlist(drop.id)).name).to.equal('Drop')
    expect(driveSetlistFiles()).to.have.length(1)
    expect(await phone.db.getPendingDeletions()).to.deep.equal([])
  })

  it('is made again by Undo after the file is in the trash, as a new file, and other devices get it', async () => {
    const phone = await makeDevice('phone')
    const tablet = await makeDevice('tablet')
    const drop = await addSetlist(phone, { name: 'Drop' })
    await syncDevice(phone)
    await syncDevice(tablet)
    const old = must(must(await phone.db.getSetlist(drop.id)).fileRef)
    const removed = must(await phone.db.removeSetlist(drop.id))
    await syncDevice(phone)
    expect(rig.storage.file(old).trashed).to.equal(true)

    await phone.db.restoreSetlist(removed)
    await syncDevice(phone)
    await syncDevice(tablet)

    const again = must(await phone.db.getSetlist(drop.id))
    expect(again.fileRef).to.not.equal(old)
    expect(driveSetlistFiles()).to.have.length(1)
    expect(must(await tablet.db.getSetlist(drop.id)).name).to.equal('Drop')
  })

  it('is told of, with the other changes not in Drive, before a reset from Drive', async () => {
    const phone = await makeDevice('phone')
    const drop = await addSetlist(phone, { name: 'Drop' })
    await syncDevice(phone)
    await phone.db.removeSetlist(drop.id)

    const unsynced = await phone.sync.findUnsyncedChanges()
    expect(unsynced.map(change => change.type)).to.deep.equal(['setlist'])
  })
})
