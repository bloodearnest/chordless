/**
 * Setting up on a device the teams the person is in (team-memberships.ts): the spaces it lacks are
 * made as joining makes them, the ones it has are not made twice, a team taken off the device on
 * purpose is not put back by itself, and nothing is done when the Worker cannot be asked. The
 * Worker's answer and the first sync are given by the test.
 */
import { expect, waitUntil } from '@open-wc/testing'
import { churchClient } from '../src/js/church-client.ts'
import type { Space } from '../src/js/data-types.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  getSpaceById,
  listSpaces,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
import { removeSpaceFromDevice } from '../src/js/space-deletion.ts'
import {
  acceptTeam,
  addMissingTeamSpaces,
  checkTeamMemberships,
  churchTeams,
  declinedTeams,
  declineTeam,
  type MyTeam,
  watchTeamMemberships,
} from '../src/js/team-memberships.ts'
import { syncTeamSpace, withMembershipLock } from '../src/js/team-spaces.ts'
import { must } from './must.ts'
import { shownToast, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('teams on another device', () => {
  let made: string[]
  let before: { id: string | null; name: string }
  let synced: string[]

  const unique = (base: string) => `${base} ${crypto.randomUUID().slice(0, 8)}`
  const id = () => `space-${crypto.randomUUID().slice(0, 12)}`
  const syncSpace = async (space: Space) => void synced.push(space.name)
  const check = (teams: MyTeam[], options: { includeDeclined?: boolean } = {}) =>
    addMissingTeamSpaces({ ...options, list: async () => teams, syncSpace })
  const teamSpaces = async (teamIds: string[]) =>
    (await listSpaces()).filter(space => space.team && teamIds.includes(space.team.id))

  beforeEach(() => {
    made = []
    synced = []
    before = getCurrentSpace()
    localStorage.removeItem('declined-team-spaces')
  })

  afterEach(async () => {
    for (const space of await listSpaces()) {
      if (space.team?.id.startsWith('space-') && made.includes(space.team.id)) {
        await deleteSpace(space.id)
      }
    }
    localStorage.removeItem('declined-team-spaces')
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  const team = (role: MyTeam['role'], extra: Partial<MyTeam> = {}): MyTeam => {
    const spaceId = id()
    made.push(spaceId)
    return { spaceId, name: unique('Church'), role, ...extra }
  }

  it('makes a space for a team the device lacks, reached through the Worker, and fetches its files', async () => {
    const writer = team('writer')
    const { added } = await check([writer])

    expect(added.map(space => space.name)).to.deep.equal([writer.name])
    const space = must(await getSpaceById(must(added[0]).id))
    expect(space.team).to.deep.equal({ id: writer.spaceId, role: 'writer' })
    expect(space.rootRef).to.equal(writer.spaceId)
    expect(space.readOnly).to.equal(false)
    expect(synced).to.deep.equal([writer.name])
  })

  it('makes a team member’s space read only', async () => {
    const reader = team('reader')
    const { added } = await check([reader])
    expect(must(await getSpaceById(must(added[0]).id)).readOnly).to.equal(true)
  })

  it('keeps church teams on the device while following controls their visibility', async () => {
    const member = team('writer', { churchId: 'church', followed: true })
    const { added } = await check([member])
    const id = must(added[0]).id
    expect(must(await getSpaceById(id)).team).to.include({ churchId: 'church', followed: true })
    await syncTeamSpace(must(await getSpaceById(id)))
    await check([{ ...member, followed: false }])
    expect(must(await getSpaceById(id)).team).to.include({ churchId: 'church', followed: false })
    await check([{ ...member, followed: true, role: 'reader' }])
    expect(must(await getSpaceById(id)).readOnly).to.equal(true)
  })

  it('does not set up a church team the person does not follow, until they do', async () => {
    const other = team('writer', { churchId: 'church', followed: false })
    expect((await check([other])).added).to.have.length(0)
    expect(await teamSpaces([other.spaceId])).to.have.length(0)
    expect((await check([{ ...other, followed: true }])).added).to.have.length(1)
  })

  it('takes a church team off the device when the church no longer has it, but only when the church was read', async () => {
    const kept = team('writer', { churchId: 'church', followed: true })
    const gone = team('writer', { churchId: 'church', followed: true })
    const { added } = await check([kept, gone])
    expect(added).to.have.length(2)
    const removed: string[] = []
    const remove = async (space: Space) => void removed.push(space.team?.id ?? '')
    // (not read: the Worker could not be reached, which says nothing of what is there)
    await addMissingTeamSpaces({ list: async () => [kept], syncSpace, remove })
    expect(removed).to.deep.equal([])
    await addMissingTeamSpaces({
      list: async () => ({ teams: [kept], churchesListed: true }),
      syncSpace,
      remove,
    })
    expect(removed).to.deep.equal([gone.spaceId])
    // (a failure to remove it is told in the log, and the rest carries on)
    await addMissingTeamSpaces({
      list: async () => ({ teams: [kept], churchesListed: true }),
      syncSpace,
      remove: async () => {
        throw new Error('no')
      },
    })
    expect(await teamSpaces([gone.spaceId])).to.have.length(1)
    // (and by default it is taken off this device, as deleting it from here is)
    await addMissingTeamSpaces({
      list: async () => ({ teams: [kept], churchesListed: true }),
      syncSpace,
    })
    expect(await teamSpaces([gone.spaceId])).to.have.length(0)
    expect(await teamSpaces([kept.spaceId])).to.have.length(1)
  })

  it('moves a Drive team’s setlists up before it becomes a church’s on this device, once, and sends them', async () => {
    const drive = team('writer')
    const { added } = await check([drive])
    const space = must(added[0])
    expect(must(await getSpaceById(space.id)).team).to.deep.equal({
      id: drive.spaceId,
      role: 'writer',
    })
    const adopted: [string, string][] = []
    const sent: string[] = []
    const options = {
      list: async () => [{ ...drive, churchId: 'church', followed: true }],
      syncSpace,
      adopt: async (spaceId: string, churchId: string) => void adopted.push([spaceId, churchId]),
      send: async (spaceId: string) => void sent.push(spaceId),
    }
    await addMissingTeamSpaces(options)
    expect(adopted).to.deep.equal([[space.id, 'church']])
    expect(sent).to.deep.equal([space.id])
    expect(must(await getSpaceById(space.id)).team).to.include({
      churchId: 'church',
      followed: true,
    })
    // (a team already a church's is not moved again)
    await addMissingTeamSpaces(options)
    expect(adopted).to.have.length(1)
    expect(sent).to.have.length(1)
  })

  it('leaves a Drive team as it was, and tries again at the next check, when its setlists could not be queued', async () => {
    const drive = team('writer')
    const { added } = await check([drive])
    const space = must(added[0])
    let fail = true
    const sent: string[] = []
    const options = {
      list: async () => [{ ...drive, churchId: 'church', followed: true }],
      syncSpace,
      adopt: async () => {
        if (fail) throw new Error('database busy')
      },
      send: async (spaceId: string) => void sent.push(spaceId),
    }
    await addMissingTeamSpaces(options)
    expect(must(await getSpaceById(space.id)).team?.churchId).to.equal(undefined)
    expect(sent).to.deep.equal([])
    fail = false
    await addMissingTeamSpaces(options)
    expect(must(await getSpaceById(space.id)).team?.churchId).to.equal('church')
    expect(sent).to.deep.equal([space.id])
  })

  it('carries on, and says so in the log, when what an adopted team holds cannot be sent yet', async () => {
    const drive = team('writer')
    const { added } = await check([drive])
    const space = must(added[0])
    let tried = 0
    await addMissingTeamSpaces({
      list: async () => [{ ...drive, churchId: 'church', followed: true }],
      syncSpace,
      adopt: async () => {},
      send: async () => {
        tried++
        throw new Error('offline')
      },
    })
    await waitUntil(() => tried === 1, 'the attempt', { timeout: 3000 })
    // (the team is the church's all the same: the ordinary syncs send it at their next tick)
    expect(must(await getSpaceById(space.id)).team?.churchId).to.equal('church')
  })

  it('loads church-wide roles and account follow choices', async () => {
    const list = churchClient.list
    const teams = churchClient.teams
    churchClient.list = async () => [
      {
        id: 'church',
        name: 'Church',
        country: 'GB',
        city: 'York',
        postcode: null,
        ccliLicence: null,
        licences: {},
        role: 'writer',
      },
    ]
    churchClient.teams = async () => [
      { id: 'team', name: 'Morning', archivedAt: null, followed: 1 },
      { id: 'old', name: 'Archived', archivedAt: '2026-01-01', followed: 1 },
    ]
    try {
      expect(await churchTeams()).to.deep.equal([
        { spaceId: 'team', name: 'Morning', role: 'writer', churchId: 'church', followed: true },
        { spaceId: 'old', name: 'Archived', role: 'writer', churchId: 'church', followed: false },
      ])
    } finally {
      churchClient.list = list
      churchClient.teams = teams
    }
  })

  it('reaches an owner’s team straight in its folder, and leaves one with no folder to be told of', async () => {
    const mine = team('owner', { rootRef: 'folder-9' })
    const lost = team('owner')
    const { added } = await check([mine, lost])

    expect(added.map(space => space.team?.id)).to.deep.equal([mine.spaceId])
    expect(must(added[0]).rootRef).to.equal('folder-9')
    expect(await teamSpaces([lost.spaceId])).to.deep.equal([])
  })

  it('does not make a space twice, for one it has or one just made', async () => {
    const writer = team('writer')
    await check([writer])
    const again = await check([writer])
    expect(again.added).to.deep.equal([])
    expect(await teamSpaces([writer.spaceId])).to.have.length(1)
  })

  it('names the space as the team is called, or adds “(team)” where the name is taken', async () => {
    const taken = await createSpace(unique('Choir'))
    made.push('none')
    try {
      const writer = team('writer', { name: taken.name })
      const { added } = await check([writer])
      expect(must(added[0]).name).to.equal(`${taken.name} (team)`)
    } finally {
      await deleteSpace(taken.id)
    }
  })

  it('brings the role of a team it has up to date, but never changes an owner’s', async () => {
    const writer = team('writer')
    await check([writer])
    await check([{ ...writer, role: 'reader' }])
    const [space] = await teamSpaces([writer.spaceId])
    expect(must(space).team?.role).to.equal('reader')
    expect(must(space).readOnly).to.equal(true)

    const owner = team('owner', { rootRef: 'folder-1' })
    await check([owner])
    await check([{ ...owner, role: 'admin' }])
    const [mine] = await teamSpaces([owner.spaceId])
    expect(must(mine).team?.role).to.equal('owner')
  })

  it('does not put back a team taken off this device on purpose, until it is asked for', async () => {
    const writer = team('writer')
    const { added } = await check([writer])
    await removeSpaceFromDevice(must(added[0]))
    expect(declinedTeams()).to.include(writer.spaceId)

    const quiet = await check([writer])
    expect(quiet.added).to.deep.equal([])
    expect(quiet.declined).to.deep.equal([writer.spaceId])

    const asked = await check([writer], { includeDeclined: true })
    expect(asked.added).to.have.length(1)
    expect(declinedTeams()).to.not.include(writer.spaceId)
  })

  it('remembers the teams declined, and forgets one accepted', () => {
    declineTeam('a')
    declineTeam('a')
    declineTeam('b')
    expect(declinedTeams()).to.deep.equal(['a', 'b'])
    acceptTeam('a')
    expect(declinedTeams()).to.deep.equal(['b'])
    localStorage.setItem('declined-team-spaces', 'not json')
    expect(declinedTeams()).to.deep.equal([])
    localStorage.setItem('declined-team-spaces', '{"a":1}')
    expect(declinedTeams()).to.deep.equal([])
  })

  it('does nothing, and does not throw, when the Worker cannot be asked', async () => {
    const report = await addMissingTeamSpaces({
      list: () => Promise.reject(new Error('offline')),
      syncSpace,
    })
    expect(report).to.deep.equal({ added: [], declined: [] })
    expect(synced).to.deep.equal([])
  })

  it('keeps the space it made when the first sync does not finish', async () => {
    const writer = team('writer')
    const { added } = await addMissingTeamSpaces({
      list: async () => [writer],
      syncSpace: () => Promise.reject(new Error('Worker down')),
    })
    expect(added).to.have.length(1)
    expect(await teamSpaces([writer.spaceId])).to.have.length(1)
  })

  it('makes the first team the space in use when the device has none', async () => {
    const was = {
      id: localStorage.getItem('current-space-id'),
      name: localStorage.getItem('current-space-name'),
    }
    localStorage.removeItem('current-space-id')
    try {
      const writer = team('writer')
      const { added } = await check([writer, team('reader')])
      expect(getCurrentSpace().id).to.equal(must(added[0]).id)
    } finally {
      if (was.id) localStorage.setItem('current-space-id', was.id)
      if (was.name) localStorage.setItem('current-space-name', was.name)
    }
  })

  it('leaves the space in use alone when there is one', async () => {
    const current = await createSpace(unique('Mine'))
    await setCurrentSpace(current.id, current.name)
    try {
      await check([team('writer')])
      expect(getCurrentSpace().id).to.equal(current.id)
    } finally {
      await deleteSpace(current.id)
    }
  })

  it('waits for a join or a new team in progress, so a half-made space is not made twice', async () => {
    const writer = team('writer')
    let release = () => {}
    const holding = withMembershipLock(
      () =>
        new Promise<void>(resolve => {
          release = resolve
        })
    )
    const asking = check([writer])
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(await teamSpaces([writer.spaceId])).to.deep.equal([])

    release()
    await holding
    await asking
    expect(await teamSpaces([writer.spaceId])).to.have.length(1)
  })

  it('tells what it added, asks no more than once in a while, and asks again when told to', async () => {
    const writer = team('writer')
    let asked = 0
    const list = async () => {
      asked++
      return [writer]
    }
    const first = await checkTeamMemberships({ force: true, list, syncSpace })
    expect(first.added).to.have.length(1)
    expect(shownToast()?.message).to.contain(first.added[0]?.name as string)

    const soon = await checkTeamMemberships({ list, syncSpace })
    expect(soon.added).to.deep.equal([])
    expect(asked).to.equal(1)

    await checkTeamMemberships({ force: true, list, syncSpace })
    expect(asked).to.equal(2)

    // (a second, with two teams: said in the plural)
    const [one, two] = [team('writer'), team('reader')]
    await checkTeamMemberships({ force: true, list: async () => [one, two], syncSpace })
    expect(shownToast()?.message).to.contain('Added 2 teams')
  })

  it('asks once when asked again while it is still asking', async () => {
    let asked = 0
    let answer = (_teams: MyTeam[]) => {}
    const list = () => {
      asked++
      return new Promise<MyTeam[]>(resolve => {
        answer = resolve
      })
    }
    const first = checkTeamMemberships({ force: true, list, syncSpace })
    const second = checkTeamMemberships({ force: true, list, syncSpace })
    expect(second).to.equal(first)
    answer([])
    await first
    expect(asked).to.equal(1)
  })

  it('takes a space made without a team for what it is', async () => {
    const personal = await createSpace(unique('Personal'))
    try {
      await updateSpace(personal.id, { rootRef: 'folder-x' })
      const { added } = await check([])
      expect(added).to.deep.equal([])
    } finally {
      await deleteSpace(personal.id)
    }
  })

  it('forgets nothing but is not stopped when the browser will not keep what was declined', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      declineTeam('x')
    } finally {
      Storage.prototype.setItem = real
    }
    expect(declinedTeams()).to.deep.equal([])
  })

  it('does the ordinary first sync when it is not given another, and keeps the space if that fails', async () => {
    const writer = team('writer')
    const { added } = await addMissingTeamSpaces({ list: async () => [writer] })
    expect(added).to.have.length(1)
  })

  it('calls a team with no name “Team”', async () => {
    const nameless = team('writer', { name: '' })
    const { added } = await check([nameless])
    expect(must(added[0]).name).to.match(/^Team/)
  })

  it('makes spaces where the browser has no Web Locks', async () => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    try {
      const { added } = await check([team('writer')])
      expect(added).to.have.length(1)
    } finally {
      // biome-ignore lint/performance/noDelete: the property was put on the navigator itself; the browser's own is behind it
      delete (navigator as { locks?: unknown }).locks
    }
  })

  it('looks when started, and again when the app comes back to the screen but not when it goes', async () => {
    // (a page in a test run may be in the background: say which it is)
    const showing = (state: 'visible' | 'hidden') => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    try {
      watchTeamMemberships()
      showing('hidden')
      showing('visible')
      // (not signed in, so there is nothing to find: it must not throw or make anything)
      await new Promise(resolve => setTimeout(resolve, 50))
    } finally {
      // biome-ignore lint/performance/noDelete: the property was put on the document itself; the browser's own is behind it
      delete (document as { visibilityState?: unknown }).visibilityState
    }
  })

  it('asks once when asked again while it is still asking', async () => {
    let asked = 0
    let answer = (_teams: MyTeam[]) => {}
    const list = () => {
      asked++
      return new Promise<MyTeam[]>(resolve => {
        answer = resolve
      })
    }
    const first = checkTeamMemberships({ force: true, list, syncSpace })
    const second = checkTeamMemberships({ force: true, list, syncSpace })
    expect(second).to.equal(first)
    answer([])
    await first
    expect(asked).to.equal(1)
  })

  it('takes a space made without a team for what it is', async () => {
    const personal = await createSpace(unique('Personal'))
    try {
      await updateSpace(personal.id, { rootRef: 'folder-x' })
      const { added } = await check([])
      expect(added).to.deep.equal([])
    } finally {
      await deleteSpace(personal.id)
    }
  })

  it('forgets nothing but is not stopped when the browser will not keep what was declined', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      declineTeam('x')
    } finally {
      Storage.prototype.setItem = real
    }
    expect(declinedTeams()).to.deep.equal([])
  })

  it('does the ordinary first sync when it is not given another, and keeps the space if that fails', async () => {
    const writer = team('writer')
    const { added } = await addMissingTeamSpaces({ list: async () => [writer] })
    expect(added).to.have.length(1)
  })

  it('calls a team with no name “Team”', async () => {
    const nameless = team('writer', { name: '' })
    const { added } = await check([nameless])
    expect(must(added[0]).name).to.match(/^Team/)
  })

  it('makes spaces where the browser has no Web Locks', async () => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    try {
      const { added } = await check([team('writer')])
      expect(added).to.have.length(1)
    } finally {
      // biome-ignore lint/performance/noDelete: the property was put on the navigator itself; the browser's own is behind it
      delete (navigator as { locks?: unknown }).locks
    }
  })

  it('looks when started, and again when the app comes back to the screen', async () => {
    watchTeamMemberships()
    document.dispatchEvent(new Event('visibilitychange'))
    // (not signed in, so there is nothing to find: it must not throw or make anything)
    await new Promise(resolve => setTimeout(resolve, 50))
  })
})
