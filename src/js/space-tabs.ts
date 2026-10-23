/**
 * The tabs under the header of the Setlists, Library and Add Song pages (docs/SPACES.md, "Space
 * tabs, and joining by invite"): one per place the person's songs and setlists are kept, and
 * only the places that exist.
 */
import type { Space } from './data-types.ts'
import { withSource } from './other-songs.ts'
import { databaseExists, SHARED_DB_ID } from './share-receiver.ts'
import { getCurrentSpace, listSpaces } from './space.ts'
import { spaceKind } from './space-label.ts'
import { contentsOf } from './space-transfer.ts'

/** The most tabs shown: about what fits a phone. The rest go under "More". */
export const MAX_TABS = 4

const RECENT_KEY = 'space-tabs-recent'

export interface SpaceTab {
  /** A space's id, or SHARED_DB_ID for what was shared by link */
  id: string
  name: string
  /** "Team" or "Personal", beside the name; none for Shared, or a Personal space named so */
  kind: string | null
}

/** The ids of the places last used, most recent first */
function recentIds(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Remember that a place was used, so that it stays a tab when there are too many */
export function noteTabUsed(id: string): void {
  try {
    const recent = [id, ...recentIds().filter(other => other !== id)].slice(0, 20)
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch {
    // Storage is blocked: the tabs fall back to their fixed order
  }
}

/** Whether something was shared to this device by link (what is left of it, not a database kept empty) */
async function hasShared(): Promise<boolean> {
  if (!(await databaseExists(SHARED_DB_ID))) return false
  const { songs, setlists } = await withSource(SHARED_DB_ID, db => contentsOf(db))
  return songs.count + setlists.count > 0
}

/**
 * The tabs there are, in their fixed order: Teams, Personal, Shared. A Personal space with nothing
 * in it is left out unless it is the current one; Shared is there only when something was shared.
 * Fewer than two is no choice to make: none (the rule under "Presenting spaces").
 */
export async function loadSpaceTabs(
  currentId: string | null = getCurrentSpace().id,
  spaces?: Space[]
): Promise<SpaceTab[]> {
  const tabs = await allPlaces(currentId, spaces)
  return tabs.length < 2 ? [] : tabs
}

/** The spaces that have a tab, or all of them if none would (a space hidden is not offered unless it is the only one) */
export async function visibleSpaces(currentId: string | null, given?: Space[]): Promise<Space[]> {
  const spaces = given ?? (await listSpaces())
  const shown = new Set((await allPlaces(currentId, spaces)).map(tab => tab.id))
  const visible = spaces.filter(space => shown.has(space.id))
  return visible.length ? visible : spaces
}

async function allPlaces(currentId: string | null, given?: Space[]): Promise<SpaceTab[]> {
  const spaces = given ?? (await listSpaces())
  const teams = spaces.filter(space => space.team)
  const personal: typeof spaces = []
  for (const space of spaces.filter(space => !space.team)) {
    if (space.id === currentId || (await hasContents(space.id))) personal.push(space)
  }
  const tabs: SpaceTab[] = [...teams, ...personal].map(space => ({
    id: space.id,
    name: space.name,
    kind: spaceKind(space),
  }))
  if (await hasShared()) tabs.push({ id: SHARED_DB_ID, name: 'Shared', kind: null })
  return tabs
}

async function hasContents(spaceId: string): Promise<boolean> {
  if (!(await databaseExists(spaceId))) return false
  const { songs, setlists } = await withSource(spaceId, db => contentsOf(db))
  return songs.count + setlists.count > 0
}

/**
 * Which tabs are shown and which go under "More", both in the fixed order. The current tab and
 * the most recently used stay shown.
 */
export function splitTabs(
  tabs: SpaceTab[],
  currentId: string | null,
  recent: string[] = recentIds(),
  max: number = MAX_TABS
): { shown: SpaceTab[]; more: SpaceTab[] } {
  if (tabs.length <= max) return { shown: tabs, more: [] }
  const rank = (tab: SpaceTab) => {
    if (tab.id === currentId) return -1
    const at = recent.indexOf(tab.id)
    return at === -1 ? recent.length : at
  }
  // (a stable sort: tabs never used stay in their fixed order)
  const keep = new Set(
    [...tabs]
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, max)
      .map(tab => tab.id)
  )
  return {
    shown: tabs.filter(tab => keep.has(tab.id)),
    more: tabs.filter(tab => !keep.has(tab.id)),
  }
}
