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
import type { Space } from './data-types.ts'
import {
  hasCurrentSpace,
  listSpaces,
  SpaceChangeEvent,
  setCurrentSpace,
  updateSpace,
} from './space.ts'
import { teamApi } from './team-client.ts'
import type { TeamRole } from './team-roles.ts'
import { createLocalTeamSpace, syncTeamSpace, withMembershipLock } from './team-spaces.ts'
import { toast } from './toast.ts'

const DECLINED_KEY = 'declined-team-spaces'

/** What a check can be given (a test gives its own list of teams and first sync) */
interface CheckOptions {
  includeDeclined?: boolean
  list?: () => Promise<MyTeam[]>
  syncSpace?: (space: Space) => Promise<void>
}

/** A team the Worker says the person is in */
export interface MyTeam {
  spaceId: string
  name: string
  role: TeamRole
  /** The team's folder in Drive: given to the owner only */
  rootRef?: string
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
  try {
    mine = await (options.list ?? teamApi.list)()
  } catch (error) {
    // Not signed in, offline, or the Worker is down: nothing to learn
    console.warn('[TeamMemberships] Could not ask which teams there are:', error)
    return report
  }
  const adds: Space[] = []
  await withMembershipLock(async () => {
    const here = await listSpaces()
    const known = new Map(here.flatMap(space => (space.team ? [[space.team.id, space]] : [])))
    const declined = new Set(declinedTeams())
    for (const team of mine) {
      const space = known.get(team.spaceId)
      if (space?.team) {
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
  report.added = adds
  const first = adds[0]
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
            ? `Added the team ${names[0]}, which you are in.`
            : `Added ${names.length} teams you are in: ${names.join(', ')}.`
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkTeamMemberships()
  })
}
