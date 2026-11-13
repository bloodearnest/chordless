/**
 * The default space (docs/SPACES.md, "Presenting spaces"): one space on this device that is the
 * leftmost tab, and where an import that comes from outside the app, with no tab in front of the
 * person, goes. It is a preference of this device, kept in this browser, and it never stops
 * anything: the tab in view still decides where a person is working, and an import can be sent
 * elsewhere.
 *
 * With none chosen it is the first Team the device has (by when it was made), else the first space.
 */
import type { Space } from './data-types.ts'

const KEY = 'default-space-id'

/** The space the person chose as the default, if they chose one (it may no longer be on the device) */
export function getDefaultSpaceId(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    // Storage is blocked: the default is worked out as if none was chosen
    return null
  }
}

/** Choose the default space; null goes back to the first Team */
export function setDefaultSpaceId(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch {
    // Storage is blocked: the choice is lost, as the tabs' recent order is
  }
}

/** For sorting spaces into the order they were made (the id settles two made in the same moment) */
export const bySpaceAge = (a: Space, b: Space) =>
  a.createdDate.localeCompare(b.createdDate) || a.id.localeCompare(b.id)

/** The default space among `spaces`: the one chosen if it is there, else the first Team, else the first space */
export function defaultSpaceOf(
  spaces: Space[],
  chosen: string | null = getDefaultSpaceId()
): Space | undefined {
  const ordered = [...spaces].sort(bySpaceAge)
  return (
    ordered.find(space => space.id === chosen) ?? ordered.find(space => space.team) ?? ordered[0]
  )
}

/**
 * Where an import from outside the app goes: the default space, or, if the person can only read
 * that one (a team member, not a worship leader), the first space they can write to. The default
 * again if there is none.
 */
export function importTargetOf(
  spaces: Space[],
  chosen: string | null = getDefaultSpaceId()
): Space | undefined {
  const preferred = defaultSpaceOf(spaces, chosen)
  if (!preferred || !preferred.readOnly) return preferred
  const ordered = [...spaces].sort(bySpaceAge)
  return (
    ordered.find(space => space.team && !space.readOnly) ??
    ordered.find(space => !space.readOnly) ??
    preferred
  )
}
