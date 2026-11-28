/**
 * The teams a person is in, on a device that has not set them up (docs/SPACES.md, "Teams on
 * another device"). A team space is on a device because that device joined it; a second device, or
 * a new browser, signed in as the same person would not have it. The Worker knows who is in what
 * (`GET /api/spaces`), so the device asks, and makes the spaces it lacks, as joining does, then does
 * their first sync.
 *
 * Nothing is tracked beyond the Worker's own membership, but for the teams the person took off this
 * device on purpose (`declineTeam`): those are not put back. Asking by hand (`includeDeclined`)
 * does put them back.
 */

import { ChurchTeamsChangedEvent, churchClient } from './church-client.ts'
import { announceDataChange } from './data-changes.ts'
import type { Space } from './data-types.ts'
import {
  hasCurrentSpace,
  listSpaces,
  SpaceChangeEvent,
  setCurrentSpace,
  updateSpace,
} from './space.ts'
import { seedTeamAdoption, sendAdopted } from './team-adoption.ts'
import { teamApi } from './team-client.ts'
import type { TeamRole } from './team-roles.ts'
import { createLocalTeamSpace, syncTeamSpace, withMembershipLock } from './team-spaces.ts'
import { t } from './text.ts'
import { toast } from './toast.ts'

const DECLINED_KEY = 'declined-team-spaces'

/** What a check can be given (a test gives its own list of teams and first sync) */
interface CheckOptions {
  includeDeclined?: boolean
  list?: () => Promise<MyTeam[] | Listed>
  /** Take a space off this device (a test gives its own) */
  remove?: (space: Space) => Promise<void>
  syncSpace?: (space: Space) => Promise<void>
  /** Queue a team's setlists to go to its church (a test gives its own) */
  adopt?: (spaceId: string, churchId: string) => Promise<void>
  /** Send what the device holds of an adopted team (a test gives its own) */
  send?: (spaceId: string) => Promise<void>
}

/**
 * The teams found, and whether the churches' own lists were read (so a team of a church that is not in them is gone, and not
 * just not heard of because the Worker could not be reached)
 */
export interface Listed {
  teams: MyTeam[]
  churchesListed: boolean
}

/** A team the Worker says the person is in */
export interface MyTeam {
  spaceId: string
  name: string
  role: TeamRole
  /** The team's folder in Drive: given to the owner only */
  rootRef?: string
  churchId?: string
  followed?: boolean
}

/** Church membership grants access to all teams; only followed teams appear on the home page. */
export async function churchTeams(): Promise<MyTeam[]> {
  const churches = await churchClient.list()
  const teams = await Promise.all(
    churches.map(async church =>
      (await churchClient.teams(church.id)).map(team => ({
        spaceId: team.id,
        name: team.name,
        role: church.role,
        churchId: church.id,
        followed: Boolean(team.followed) && !team.archivedAt,
      }))
    )
  )
  return teams.flat()
}

async function allTeams(): Promise<Listed> {
  const results = await Promise.allSettled([teamApi.list(), churchTeams()])
  const found = results.flatMap(result => (result.status === 'fulfilled' ? result.value : []))
  if (results.every(result => result.status === 'rejected')) throw new Error('Could not load teams')
  return { teams: found, churchesListed: results[1].status === 'fulfilled' }
}

/** A space taken off the device because its team was deleted from its church */
async function removeGoneSpace(space: Space): Promise<void> {
  const { removeSpaceFromDevice } = await import('./space-deletion.ts')
  await removeSpaceFromDevice(space)
}

/** The ids of the teams taken off this device on purpose */
export function declinedTeams(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(DECLINED_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeDeclined(ids: string[]): void {
  try {
    localStorage.setItem(DECLINED_KEY, JSON.stringify(ids))
  } catch {
    // (storage blocked: the team may come back at the next check, which is harmless)
  }
}

/** Do not put this team back on this device by itself */
export function declineTeam(teamId: string): void {
  const ids = declinedTeams()
  if (!ids.includes(teamId)) writeDeclined([...ids, teamId])
}

/** Forget that a team was declined (it is joined again, or asked for) */
export function acceptTeam(teamId: string): void {
  writeDeclined(declinedTeams().filter(id => id !== teamId))
}

/** What a check did */
export interface MembershipReport {
  /** The spaces made on this device */
  added: Space[]
  /** The teams the person is in that were left, as they were declined here */
  declined: string[]
}

/**
 * Make a space on this device for each team the person is in that it does not have, and bring a
 * known team's role up to date. A team space is made as joining makes it (named as the team calls
 * it, or with "(team)" added if the name is taken), its first files are fetched, and if the device
 * has no space in use the first one made is. Anything that cannot be reached leaves the device as
 * it was: the next check tries again.
 */
export async function addMissingTeamSpaces(options: CheckOptions = {}): Promise<MembershipReport> {
  const report: MembershipReport = { added: [], declined: [] }
  let mine: MyTeam[]
  let churchesListed = false
  try {
    const listed = await (options.list ?? allTeams)()
    mine = Array.isArray(listed) ? listed : listed.teams
    churchesListed = !Array.isArray(listed) && listed.churchesListed
  } catch (error) {
    // Not signed in, offline, or the Worker is down: nothing to learn
    console.warn('[TeamMemberships] Could not ask which teams there are:', error)
    return report
  }
  const adds: Space[] = []
  const adopted: string[] = []
  await withMembershipLock(async () => {
    const here = await listSpaces()
    const known = new Map(here.flatMap(space => (space.team ? [[space.team.id, space]] : [])))
    const declined = new Set(declinedTeams())
    // A church's team that the church no longer has (an admin deleted it) is not kept here: there is nothing for it to sync with
    if (churchesListed) {
      const listedIds = new Set(mine.map(team => team.spaceId))
      for (const space of here) {
        if (!space.team?.churchId || listedIds.has(space.team.id)) continue
        try {
          await (options.remove ?? removeGoneSpace)(space)
          known.delete(space.team.id)
        } catch (error) {
          console.warn(`[TeamMemberships] Could not take ${space.name} off this device:`, error)
        }
      }
    }
    for (const team of mine) {
      const space = known.get(team.spaceId)
      if (space?.team) {
        if (team.churchId) {
          // A team that was on Drive and is now a church's: this device's setlists are queued to go up before anything is taken
          // down, and its songs go with the first sync (step 8); a failure leaves it as it was, and the next check tries again
          if (!space.team.churchId) {
            try {
              /* v8 ignore next -- the real one needs the device's database and the Worker: its rule is tested in team-adoption.test.ts */
              await (options.adopt ?? seedTeamAdoption)(space.id, team.churchId)
              adopted.push(space.id)
            } catch (error) {
              console.warn(`[TeamMemberships] Could not move ${space.name} into its church:`, error)
              continue
            }
          }
          await updateSpace(space.id, {
            team: {
              id: team.spaceId,
              role: team.role,
              churchId: team.churchId,
              followed: team.followed,
            },
            readOnly: team.role === 'reader',
          })
          if (space.team.followed !== team.followed)
            announceDataChange({ spaceId: space.id, kind: 'setlist', ids: null, origin: 'sync' })
          continue
        }
        // (an owner's role never changes, and it is how the space is reached: left as it is)
        if (space.team.role !== team.role && space.team.role !== 'owner' && team.role !== 'owner') {
          await updateSpace(space.id, {
            team: { ...space.team, role: team.role },
            readOnly: team.role === 'reader',
          })
        }
        continue
      }
      if (declined.has(team.spaceId)) {
        if (!options.includeDeclined) {
          report.declined.push(team.spaceId)
          continue
        }
        acceptTeam(team.spaceId)
      }
      // A church's team the person does not follow is not set up here (its songs and setlists are not fetched): all of a church's
      // people may reach all its teams, but each is on a device for the teams they follow, and following one sets it up
      if (team.churchId && !team.followed) continue
      // (an owner's device reaches the folder straight, so needs its id; without it there is no way in)
      if (team.role === 'owner' && !team.rootRef) continue
      adds.push(await createLocalTeamSpace(team))
    }
  })
  for (const space of adds) {
    try {
      await (options.syncSpace ?? syncTeamSpace)(space)
    } catch (error) {
      // (the space is made: its ordinary syncs go on from here)
      console.warn(`[TeamMemberships] The first sync of ${space.name} did not finish:`, error)
    }
  }
  /* v8 ignore next 4 -- the real one needs the Worker and a session */
  for (const id of adopted)
    void (options.send ?? sendAdopted)(id).catch(error =>
      console.warn('[TeamMemberships] Could not send an adopted team:', error)
    )
  report.added = adds
  const first = adds.find(space => !space.team?.churchId || space.team.followed)
  if (first && !hasCurrentSpace()) {
    await setCurrentSpace(first.id, first.name)
    window.dispatchEvent(new SpaceChangeEvent(first.id))
  }
  if (adds.length > 0) window.dispatchEvent(new TeamSpacesAddedEvent(adds))
  return report
}

/** Spaces were made on this device for teams the person is in (sent on window) */
export class TeamSpacesAddedEvent extends Event {
  static readonly type = 'team-spaces:added'
  readonly spaces: Space[]
  constructor(spaces: Space[]) {
    super(TeamSpacesAddedEvent.type)
    this.spaces = spaces
  }
}

/** How long the app is left before it asks again, when it comes back to the screen */
export const CHECK_EVERY_MS = 15 * 60 * 1000

let lastCheck = 0
let checking: Promise<MembershipReport> | null = null

/**
 * Ask which teams the person is in and set up the ones this device lacks, telling them what was
 * added. One check at a time; `force` asks again however recently it did (a sign-in, or the button).
 */
export function checkTeamMemberships(
  options: CheckOptions & { force?: boolean } = {}
): Promise<MembershipReport> {
  if (checking) return checking
  if (!options.force && Date.now() - lastCheck < CHECK_EVERY_MS) {
    return Promise.resolve({ added: [], declined: [] })
  }
  lastCheck = Date.now()
  checking = addMissingTeamSpaces(options)
    .then(report => {
      if (report.added.length > 0) {
        const names = report.added.map(space => space.name)
        toast(
          names.length === 1
            ? t('toast-teams-added-one', { name: names[0] as string })
            : t('toast-teams-added-many', { count: names.length, names: names.join(', ') })
        )
      }
      return report
    })
    .finally(() => {
      checking = null
    })
  return checking
}

/** Check now, and again whenever the app comes back to the screen after a while (called once, at start-up) */
export function watchTeamMemberships(): void {
  void checkTeamMemberships()
  window.addEventListener(
    ChurchTeamsChangedEvent.type,
    () => void checkTeamMemberships({ force: true })
  )
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkTeamMemberships()
  })
}
