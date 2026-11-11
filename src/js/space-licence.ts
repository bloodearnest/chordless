/**
 * A space's CCLI licence number (docs/SPACES.md, "SongSelect's terms"). A Team's is kept by the
 * Worker with the team, with a log of who changed it and when, because CCLI may ask for it and a
 * record of the teams using Chordless is wanted; this device keeps a copy to show. A personal
 * space's is kept here alone.
 */
import { cleanLicence, type TeamLicence } from './ccli-licence.ts'
import type { Space } from './data-types.ts'
import { updateSpace } from './space.ts'
import { teamApi } from './team-client.ts'
import { atLeast } from './team-roles.ts'

/** The space's number as it stands (from the Worker for a Team, which this device then copies) */
export async function readLicence(space: Space): Promise<TeamLicence> {
  if (!space.team) return { ccliLicence: space.ccliLicence ?? null }
  const known = await teamApi.licence(space.team.id)
  await keep(space, known.ccliLicence)
  return known
}

/**
 * Whether this person may set the number now: anyone who can write may where it is empty, and
 * only an admin may change or clear it (the Worker holds to the same). A personal space's is theirs.
 */
export function mayEditLicence(space: Space, current: string | null): boolean {
  if (!space.team) return true
  return atLeast(space.team.role, current ? 'admin' : 'writer')
}

/** Set the number as typed (empty clears it); a Team's goes to the Worker first, so a refusal changes nothing here */
export async function saveLicence(space: Space, typed: string): Promise<TeamLicence> {
  const licence = cleanLicence(typed)
  const saved = space.team
    ? await teamApi.setLicence(space.team.id, licence)
    : { ccliLicence: licence || null }
  await keep(space, saved.ccliLicence)
  return saved
}

/**
 * A chart from SongSelect carried this number. A space with none takes it, silently. For a Team,
 * the Worker is asked each time (not just when this device has none), so a number kept only
 * here because the Worker could not be reached is sent on the next import, and one that is
 * already the team's is copied here instead of written over. Failing is not an error to
 * show: the number is kept here, and the next import tries again.
 */
export async function noteLicence(space: Space, licence: string): Promise<void> {
  if (!space.team) {
    if (!space.ccliLicence) await keep(space, licence)
    return
  }
  try {
    const { ccliLicence: theirs } = await teamApi.licence(space.team.id)
    if (theirs) return keep(space, theirs)
    if (atLeast(space.team.role, 'writer')) await teamApi.setLicence(space.team.id, licence)
    await keep(space, licence)
  } catch {
    if (!space.ccliLicence) await keep(space, licence)
  }
}

/** Keep this device's copy, if it is not already that */
async function keep(space: Space, ccliLicence: string | null): Promise<void> {
  if ((space.ccliLicence ?? null) !== ccliLicence) {
    await updateSpace(space.id, { ccliLicence: ccliLicence ?? undefined })
  }
}
