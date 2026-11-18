/**
 * The tabs under the header of the Setlists, Library and Add Song pages (docs/SPACES.md, "Space
 * tabs, and joining by invite"): one per place the person's songs and setlists are kept, and
 * only the places that exist.
 */
import type { Space } from './data-types.ts'
import { bySpaceAge, defaultSpaceOf } from './default-space.ts'
import { withSource } from './other-songs.ts'
import { databaseExists, SHARED_DB_ID } from './share-receiver.ts'
import { listSpaces } from './space.ts'
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
  /** The default space (docs/SPACES.md, "Presenting spaces"): the leftmost tab, and always shown */
  isDefault?: boolean
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
 * The tabs there are, in their fixed order: Teams, Personal, Shared, with the default space first.
 * Every Teams and Personal space has one, however little is in it (a Personal space is the safe place to try
 * a setlist, so it is always there); Shared is there only when something was shared.
 * Fewer than two is no choice to make: none (the rule under "Presenting spaces").
 */
export async function loadSpaceTabs(spaces?: Space[]): Promise<SpaceTab[]> {
  const tabs = await allPlaces(spaces)
  return tabs.length < 2 ? [] : tabs
}

/** The spaces that have a tab: every one (and Shared is not a space) */
export async function visibleSpaces(given?: Space[]): Promise<Space[]> {
  return given ?? (await listSpaces())
}

async function allPlaces(given?: Space[]): Promise<SpaceTab[]> {
  // (in the order they were made: the database lists them by id, which is no order at all)
  const spaces = [...(given ?? (await listSpaces()))].sort(bySpaceAge)
  const teams = spaces.filter(space => space.team)
  const personal = spaces.filter(space => !space.team)
  const preferred = defaultSpaceOf(spaces)?.id
  const tabs: SpaceTab[] = [...teams, ...personal].map(space => ({
    id: space.id,
    name: space.name,
    kind: spaceKind(space),
    ...(space.id === preferred ? { isDefault: true } : {}),
  }))
  const first = tabs.findIndex(tab => tab.isDefault)
  if (first > 0) tabs.unshift(...tabs.splice(first, 1))
  if (await hasShared()) tabs.push({ id: SHARED_DB_ID, name: 'Shared', kind: null })
  return tabs
}

/**
 * Which tabs are shown and which go under "More", both in the fixed order. The current tab, the
 * default and the most recently used stay shown.
 */
export function splitTabs(
  tabs: SpaceTab[],
  currentId: string | null,
  recent: string[] = recentIds(),
  max: number = MAX_TABS
): { shown: SpaceTab[]; more: SpaceTab[] } {
  if (tabs.length <= max) return { shown: tabs, more: [] }
  const rank = (tab: SpaceTab) => {
    if (tab.id === currentId) return -2
    if (tab.isDefault) return -1
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
