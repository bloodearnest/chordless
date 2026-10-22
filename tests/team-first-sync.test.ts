/**
 * The first sync of a team space that is not the one in use (syncTeamSpace): a space just made
 * syncs its own data, not the data of the space in use. Against FakeDrive, as the owner syncs
 * straight to Drive.
 */
import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { createTeamFolder } from '../src/js/drive-api.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  getSpaceById,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
import { syncTeamSpace } from '../src/js/team-spaces.ts'
import { makeSetlist } from './builders.ts'
import { useFakeDriveRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, afterEach } = window

suppressConsoleLogs()

describe('syncTeamSpace', () => {
  const rig = useFakeDriveRig()
  const made: string[] = []

  afterEach(async () => {
    for (const id of made.splice(0)) await deleteSpace(id).catch(() => {})
  })

  it('puts the space’s own setlists in its folder, and leaves the space in use alone', async () => {
    const parent = await createTeamFolder('root', 'Parent')
    const folder = await createTeamFolder(parent, 'Team')
    const team = await createSpace(`First sync ${crypto.randomUUID().slice(0, 8)}`)
    made.push(team.id)
    await updateSpace(team.id, { rootRef: folder, team: { id: 'space-ffff6666', role: 'owner' } })

    const db = new ChordlessDB(team.id)
    await db.init()
    await db.saveSetlist(makeSetlist({ id: 'team-list', date: '2026-12-06' }))
    db.db?.close()

    // (the space in use has a setlist of its own, which must not be uploaded)
    const before = getCurrentSpace()
    const current = await createSpace(`In use ${crypto.randomUUID().slice(0, 8)}`)
    made.push(current.id)
    await setCurrentSpace(current.id, current.name)
    const inUse = new ChordlessDB(current.id)
    await inUse.init()
    await inUse.saveSetlist(makeSetlist({ id: 'current-list', date: '2026-12-13' }))
    await syncTeamSpace(must(await getSpaceById(team.id)))

    expect(rig.driveSetlistFiles().map(file => file.appProperties.setlistId)).to.deep.equal([
      'team-list',
    ])
    expect(rig.driveSetlist('team-list').id).to.equal('team-list')
    expect(must(await inUse.getSetlist('current-list')).fileRef ?? null).to.equal(null)
    inUse.db?.close()
    if (before.id) await setCurrentSpace(before.id, before.name)
  })
})
