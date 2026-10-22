/**
 * How a space is named to people (docs/SPACES.md, "Naming"): the UI says Personal and Team, never
 * "space". A personal space reads "<name> ~ Personal" ("Personal" alone while it still has that
 * name), a team "<name> ~ Team".
 */
import type { Space } from './data-types.ts'
import { roleLabel } from './team-spaces.ts'

/** The space's name with its kind: "Bea Singer ~ Personal", "Gateway Church ~ Team" */
export function spaceTitle(space: Pick<Space, 'name' | 'team'>): string {
  if (space.team) return `${space.name} ~ Team`
  return space.name === 'Personal' ? 'Personal' : `${space.name} ~ Personal`
}

/** What the person is in a team, or that a space is view-only; null for a space of their own */
export function spaceRole(space: Pick<Space, 'team' | 'readOnly'>): string | null {
  if (space.team) return roleLabel(space.team.role)
  return space.readOnly ? 'view only' : null
}
