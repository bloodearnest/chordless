/**
 * Deleting a space (space-deletion.ts): from this device alone, and everywhere (its Drive folder to the
 * trash first). The Drive is the fake one; the Worker's part of a Team's deletion is tested where the
 * Worker is (team-routes.node.test.ts), so here the call to it is replaced.
 */
import { expect } from '@open-wc/testing'
import type { Space } from '../src/js/data-types.ts'
import { createTeamFolder } from '../src/js/drive-api.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  getSpaceById,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
import {
  deleteSpaceEverywhere,
  mayDeleteEverywhere,
  removeSpaceFromDevice,
} from '../src/js/space-deletion.ts'
import { storageFor } from '../src/js/storage/space-storage.ts'
import { teamApi } from '../src/js/team-client.ts'
import type { TeamRole } from '../src/js/team-roles.ts'
import { useFakeDriveRig } from './drive-harness.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('deleting a space', () => {
  const rig = useFakeDriveRig()
  const made: string[] = []
  let before: { id: string | null; name: string }
  const realDeleteEverything = teamApi.deleteEverything
  let teamCalls: string[]

  const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`
  async function space(name: string, updates: Partial<Space> = {}): Promise<Space> {
    const created = await createSpace(unique(name))
    made.push(created.id)
    return Object.keys(updates).length ? updateSpace(created.id, updates) : created
  }
  const gone = async (id: string) => (await getSpaceById(id)) === undefined
  const trashed = (ref: string) => must(rig.drive.files.get(ref)).trashed === true

  beforeEach(() => {
    before = getCurrentSpace()
    teamCalls = []
    teamApi.deleteEverything = async id => {
      teamCalls.push(id)
    }
  })

  afterEach(async () => {
    teamApi.deleteEverything = realDeleteEverything
    for (const id of made.splice(0)) await deleteSpace(id).catch(() => {})
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  describe('who may delete everywhere', () => {
    it('is whoever has a personal space, and a Team’s admin and owner, and no one else', () => {
      expect(mayDeleteEverywhere({})).to.equal(true)
      const as = (role: TeamRole) => mayDeleteEverywhere({ team: { id: 't', role } })
      expect(as('owner')).to.equal(true)
      expect(as('admin')).to.equal(true)
      expect(as('writer')).to.equal(false)
      expect(as('reader')).to.equal(false)
    })
  })

  describe('everywhere', () => {
    it('puts a personal space’s Drive folder in the trash, and removes it from this device', async () => {
      const folder = await createTeamFolder('root', unique('Personal folder'))
      const personal = await space('Mine', { rootRef: folder })
      await deleteSpaceEverywhere(personal)
      expect(trashed(folder)).to.equal(true)
      expect(await gone(personal.id)).to.equal(true)
    })

    it('finds a personal space’s folder by its name when this device never linked it', async () => {
      const personal = await space('Found by name')
      const { ref } = await storageFor(personal).ensureRoot(personal.name, personal.id)
      await deleteSpaceEverywhere(personal)
      expect(trashed(ref)).to.equal(true)
      expect(await gone(personal.id)).to.equal(true)
    })

    it('is fine for a space with no folder in Drive, and for one already in the trash', async () => {
      const never = await space('Never synced')
      await deleteSpaceEverywhere(never)
      expect(await gone(never.id)).to.equal(true)

      const folder = await createTeamFolder('root', unique('Already trashed'))
      rig.drive.files.get(folder).trashed = true
      const twice = await space('Twice', { rootRef: folder })
      await deleteSpaceEverywhere(twice)
      expect(await gone(twice.id)).to.equal(true)
    })

    it('leaves the space on this device when the folder cannot be trashed, so it can be tried again', async () => {
      const folder = await createTeamFolder('root', unique('Stuck folder'))
      const personal = await space('Stuck', { rootRef: folder })
      rig.drive.failRequests({ method: 'PATCH', path: /\/files\//, status: 500 })
      let said = ''
      try {
        await deleteSpaceEverywhere(personal)
      } catch (error) {
        said = (error as Error).message
      }
      expect(said).to.contain('Injected 500')
      expect(await gone(personal.id)).to.equal(false)
      expect(trashed(folder)).to.equal(false)

      await deleteSpaceEverywhere(personal)
      expect(trashed(folder)).to.equal(true)
    })

    it('asks the team service to do a Team’s, for an admin, and removes it from this device', async () => {
      const team = await space('Church', { team: { id: 'space-eeee5555', role: 'admin' } })
      await deleteSpaceEverywhere(team)
      expect(teamCalls).to.deep.equal(['space-eeee5555'])
      expect(await gone(team.id)).to.equal(true)
    })

    it('does nothing for a Team’s writer or reader', async () => {
      const team = await space('Writers', { team: { id: 'space-ffff6666', role: 'writer' } })
      let said = ''
      try {
        await deleteSpaceEverywhere(team)
      } catch (error) {
        said = (error as Error).message
      }
      expect(said).to.contain('Only an admin')
      expect(teamCalls).to.deep.equal([])
      expect(await gone(team.id)).to.equal(false)
    })

    it('leaves a Team on this device when the team service refuses', async () => {
      const team = await space('Refused', { team: { id: 'space-aaaa7777', role: 'owner' } })
      teamApi.deleteEverything = async () => {
        throw new Error('The space owner needs to reconnect Google Drive')
      }
      let said = ''
      try {
        await deleteSpaceEverywhere(team)
      } catch (error) {
        said = (error as Error).message
      }
      expect(said).to.contain('reconnect')
      expect(await gone(team.id)).to.equal(false)
    })
  })

  describe('from this device', () => {
    it('leaves the Drive folder alone, and the space in use', async () => {
      const folder = await createTeamFolder('root', unique('Kept folder'))
      const personal = await space('Kept', { rootRef: folder })
      const result = await removeSpaceFromDevice(personal)
      expect(result.wasCurrent).to.equal(false)
      expect(await gone(personal.id)).to.equal(true)
      expect(trashed(folder)).to.equal(false)
      expect(getCurrentSpace().id).to.equal(before.id)
    })

    it('can be the space in use: another is made the one in use', async () => {
      const first = await space('In use')
      const second = await space('The next')
      await setCurrentSpace(first.id, first.name)
      const result = await removeSpaceFromDevice(first)
      expect(result.wasCurrent).to.equal(true)
      expect(await gone(first.id)).to.equal(true)
      const now = getCurrentSpace()
      expect(now.id).to.not.equal(first.id)
      expect(now.id).to.not.equal(null)
      expect(now.name).to.equal((must(await getSpaceById(now.id)) as Space).name)
      expect(second.id).to.be.a('string')
    })

    it('can be the only space: none is then in use, and Personal is made when the app needs one', async () => {
      const only = await space('Only one')
      await setCurrentSpace(only.id, only.name)
      const result = await removeSpaceFromDevice(only, async () => [only])
      expect(result.wasCurrent).to.equal(true)
      expect(getCurrentSpace().id).to.equal(null)
    })
  })
})
