/**
 * How a space is shown to people (docs/SPACES.md, "Naming"): the UI says Personal and Team, never
 * "space". The name is the title, and what kind it is goes beside it as a label.
 */
import type { Space } from './data-types.ts'
import { roleLabel } from './team-spaces.ts'

/**
 * The label for what kind of space it is: "Team", or "Personal" for a space of one's own. A personal
 * space still called "Personal" needs no label, as its name says it.
 */
export function spaceKind(space: Pick<Space, 'name' | 'team'>): string | null {
  if (space.team) return 'Team'
  return space.name === 'Personal' ? null : 'Personal'
}

/** What the person is in a Team, or that a space is view-only; null for a space of their own */
export function spaceRole(space: Pick<Space, 'team' | 'readOnly'>): string | null {
  if (space.team) return roleLabel(space.team.role)
  return space.readOnly ? 'view only' : null
}
