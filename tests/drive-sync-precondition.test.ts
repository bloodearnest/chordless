/**
 * An update is for the file as the device last saw it (`ifRev`, docs/SYNC_ARCHITECTURE.md,
 * "Several people editing a setlist"): a storage that checks it (the team service) refuses a write
 * over a change made since, and the record stays changed, so the next sync, which pulls first,
 * sorts it out by the usual rules.
 */
import { expect } from '@open-wc/testing'
import { useSyncRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('Drive sync: writing a file as it was last seen', () => {
  const rig = useSyncRig()
  const { makeDevice, addSetlist, editSetlist, syncDevice, driveSetlist } = rig

  it('sends the rev it last synced with an update, and none with a file it has not sent yet', async () => {
    const phone = await makeDevice('phone')
    const set = await addSetlist(phone, { name: 'Sunday' })
    await syncDevice(phone)
    expect(rig.storage.updates).to.deep.equal([])
    const ref = must(must(await phone.db.getSetlist(set.id)).fileRef)
    const rev = rig.storage.file(ref).rev

    await editSetlist(phone, set.id, { name: 'Sunday evening' })
    await syncDevice(phone)
    const sent = rig.storage.updates.filter(update => update.ref === ref)
    expect(sent.map(update => update.ifRev)).to.deep.equal([rev])
    expect(driveSetlist(set.id).name).to.equal('Sunday evening')
  })

  it('keeps the change here when the storage refuses it, and sends it once the file is read again', async () => {
    rig.storage.checksRev = true
    const phone = await makeDevice('phone')
    const set = await addSetlist(phone, { name: 'Sunday' })
    await syncDevice(phone)
    const ref = must(must(await phone.db.getSetlist(set.id)).fileRef)

    await editSetlist(phone, set.id, { name: 'Mine' })
    rig.storage.fail('update', { status: 409, times: 5 })
    rig.storage.fail('updateMany', { status: 409, times: 5 })
    await syncDevice(phone)
    expect(driveSetlist(set.id).name).to.equal('Sunday')
    expect(must(await phone.db.getSetlist(set.id)).name).to.equal('Mine')

    rig.storage.clearFailures()
    await syncDevice(phone)
    expect(driveSetlist(set.id).name).to.equal('Mine')
    expect(rig.storage.file(ref).trashed).to.equal(false)
  })
})
