// Space management utilities
//
// Hybrid approach:
// - Space metadata (id, name, owner, etc.) stored in SpaceDB (IndexedDB)
// - Current space ID stored in localStorage: current-space-id
// - Current space NAME cached in localStorage: current-space-name (for sync access)

import type { Space } from './data-types.ts'
import { SpaceDB } from './space-db.ts'

const SPACE_ID_KEY = 'current-space-id'
const SPACE_NAME_KEY = 'current-space-name'
const SPACE_READ_ONLY_KEY = 'current-space-read-only'
const DEFAULT_SPACE_NAME = 'Personal'

/** The keys these were kept under when a space was called an organisation */
const LEGACY_KEYS: [legacy: string, current: string][] = [
  ['current-organisation-id', SPACE_ID_KEY],
  ['current-organisation-name', SPACE_NAME_KEY],
  ['current-organisation-read-only', SPACE_READ_ONLY_KEY],
]

/** Move values kept under the old keys to the new ones (once; a value already there wins) */
export function migrateLegacyKeys(): void {
  try {
    for (const [legacy, current] of LEGACY_KEYS) {
      const value = localStorage.getItem(legacy)
      if (value === null) continue
      if (localStorage.getItem(current) === null) localStorage.setItem(current, value)
      localStorage.removeItem(legacy)
    }
  } catch {
    // Storage is blocked: there is nothing to move, and nothing else would work either
  }
}

migrateLegacyKeys()

let spaceDB: SpaceDB | null = null
let initPromise: Promise<SpaceDB> | null = null

/**
 * Get or initialize the space database
 */
async function getSpaceDB(): Promise<SpaceDB> {
  // If we have a DB instance, return it
  if (spaceDB) {
    return spaceDB
  }

  // If initialization is in progress, wait for it
  if (initPromise) {
    return initPromise
  }

  // Start initialization
  initPromise = (async () => {
    try {
      const db = new SpaceDB()
      await db.init()
      spaceDB = db
      return db
    } catch (error) {
      console.error('[Space] Failed to initialize SpaceDB:', error)
      throw error
    } finally {
      initPromise = null
    }
  })()

  return initPromise
}

/**
 * Get the current space from localStorage
 * This is synchronous and reads from cached values
 * @returns Current space {id, name}
 */
export function getCurrentSpace(): { id: string | null; name: string } {
  const id = localStorage.getItem(SPACE_ID_KEY)
  const name = localStorage.getItem(SPACE_NAME_KEY) || DEFAULT_SPACE_NAME
  return { id, name }
}

/**
 * Whether the user can only read the current space's Drive folder (known after a sync
 * has asked Drive). Read from localStorage, so it can be asked at any moment.
 */
function isReadOnlySpace(): boolean {
  return localStorage.getItem(SPACE_READ_ONLY_KEY) === '1'
}

/**
 * Whether the current space's local changes go back to Drive. A user who can only read
 * it still edits what they see (a late song, a key change); those changes stay on this device,
 * and a pull leaves them (docs/SPACES.md, "Read-only: local edits are never blocked").
 */
export function syncsBack(): boolean {
  return !isReadOnlySpace()
}

/** Record that the user can (or can only read) a space's Drive folder */
export async function setSpaceReadOnly(spaceId: string, readOnly: boolean): Promise<void> {
  const db = await getSpaceDB()
  const space = await db.getSpace(spaceId)
  if (space && Boolean(space.readOnly) !== readOnly) {
    await db.updateSpace(spaceId, { readOnly })
  }
  if (getCurrentSpace().id === spaceId) {
    cacheReadOnly(readOnly)
  }
}

function cacheReadOnly(readOnly: boolean): void {
  if (readOnly) localStorage.setItem(SPACE_READ_ONLY_KEY, '1')
  else localStorage.removeItem(SPACE_READ_ONLY_KEY)
}

let defaultSpacePromise: Promise<Space> | null = null

/**
 * The default space, created if there isn't one. Callers at the same
 * time share one attempt, so it's only created once; and if another page (or
 * tab) creates it first, it's read back rather than failing on the name.
 */
function getOrCreateDefaultSpace(): Promise<Space> {
  defaultSpacePromise ??= (async () => {
    const db = await getSpaceDB()
    const existing = await db.getSpaceByName(DEFAULT_SPACE_NAME)
    if (existing) return existing
    try {
      const created = await db.createSpace(DEFAULT_SPACE_NAME)
      return created
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ConstraintError') throw error
      const found = await db.getSpaceByName(DEFAULT_SPACE_NAME)
      if (!found) throw error
      return found
    }
  })().finally(() => {
    defaultSpacePromise = null
  })
  return defaultSpacePromise
}

/**
 * Ensure a current space exists, creating default if needed
 * Call this on app startup before using getCurrentSpace()
 * @returns Current space
 */
export async function ensureCurrentSpace(): Promise<{ id: string; name: string }> {
  const { id, name } = getCurrentSpace()

  // If we have a space ID, we're good
  if (id) {
    return { id, name }
  }

  // No space set - get or create default
  const defaultSpace = await getOrCreateDefaultSpace()

  // Set as current
  await setCurrentSpace(defaultSpace.id, defaultSpace.name)

  return { id: defaultSpace.id, name: defaultSpace.name }
}

/**
 * Get the full current space object from database
 * Use this when you need owner, members, timestamps, etc.
 * @returns Current space with id, name, members, etc.
 */
export async function getCurrentSpaceFull(): Promise<Space> {
  const db = await getSpaceDB()
  const { id } = getCurrentSpace()

  if (id) {
    const space = await db.getSpace(id)
    if (space) {
      // Update name cache in case it changed
      localStorage.setItem(SPACE_NAME_KEY, space.name)
      return space
    }
    // ID exists but space not found - clear stale data
    console.warn('[Space] Stored space ID not found, creating default:', id)
    localStorage.removeItem(SPACE_ID_KEY)
    localStorage.removeItem(SPACE_NAME_KEY)
    localStorage.removeItem(SPACE_READ_ONLY_KEY)
  }

  // No current space or space not found - create/get default
  const defaultSpace = await getOrCreateDefaultSpace()

  // Set as current
  await setCurrentSpace(defaultSpace.id, defaultSpace.name)
  return defaultSpace
}

/**
 * Set the current space by ID
 * Also caches the name in localStorage for synchronous access
 * @param spaceId - ID of space to set as current
 * @param spaceName - Name of space (optional, will fetch if not provided)
 */
export async function setCurrentSpace(
  spaceId: string,
  spaceName: string | null = null
): Promise<void> {
  localStorage.setItem(SPACE_ID_KEY, spaceId)

  // Cache the name if provided, and whether the folder is read-only
  if (spaceName) localStorage.setItem(SPACE_NAME_KEY, spaceName)
  try {
    const space = await (await getSpaceDB()).getSpace(spaceId)
    if (space && !spaceName) localStorage.setItem(SPACE_NAME_KEY, space.name)
    cacheReadOnly(Boolean(space?.readOnly))
  } catch (error) {
    console.error('[Space] Failed to read the space:', error)
  }
}

/**
 * Switch to a different space (saves ID and reloads app)
 * @param spaceId - ID of space to switch to
 * @param reload - starts the app afresh (the page reloads: a test gives its own)
 */
export async function switchSpace(
  spaceId: string,
  /* v8 ignore next 2 -- reloading the page would end the test run: tests give their own */
  // biome-ignore lint/plugin: the database is another space's now, so start afresh
  reload: () => void = () => window.location.reload()
): Promise<void> {
  // Get the space to cache its name
  try {
    const db = await getSpaceDB()
    const space = await db.getSpace(spaceId)
    if (space) {
      await setCurrentSpace(spaceId, space.name)
    } else {
      await setCurrentSpace(spaceId)
    }
  } catch (error) {
    console.error('[Space] Error switching space:', error)
    await setCurrentSpace(spaceId)
  }

  reload()
}

/**
 * Get all spaces
 */
export async function listSpaces(): Promise<Space[]> {
  const db = await getSpaceDB()
  return await db.getAllSpaces()
}

/**
 * Create a new space
 * @param name - Name of the space
 * @returns Created space object
 */
export async function createSpace(name: string): Promise<Space> {
  const db = await getSpaceDB()
  return await db.createSpace(name)
}

/**
 * Rename a space
 * Updates the name in the database (ID stays the same, so no data migration needed!)
 * @param spaceId - ID of space to rename
 * @param newName - New name for the space
 * @returns Updated space object
 */
export async function renameSpace(spaceId: string, newName: string): Promise<Space> {
  const db = await getSpaceDB()

  // Get current space
  const space = await db.getSpace(spaceId)
  if (!space) {
    throw new Error(`Space ${spaceId} not found`)
  }

  // Check if new name already exists
  const existing = await db.getSpaceByName(newName)
  if (existing && existing.id !== spaceId) {
    throw new Error(`Space "${newName}" already exists`)
  }

  // Update the name (updateSpace expects (id, updates))
  const updated = await db.updateSpace(spaceId, { name: newName })

  // Update name cache if this is the current space
  if (getCurrentSpace().id === spaceId) {
    localStorage.setItem(SPACE_NAME_KEY, newName)
  }

  return updated
}

/**
 * Get space by name
 * @param name - Space name
 * @returns Space object, if there is one
 */
export async function getSpaceByName(name: string): Promise<Space | undefined> {
  const db = await getSpaceDB()
  return await db.getSpaceByName(name)
}

/**
 * Delete a space and its data database
 * WARNING: This is destructive and cannot be undone
 * @param spaceId - ID of space to delete
 */
export async function deleteSpace(spaceId: string): Promise<void> {
  const db = await getSpaceDB()
  const space = await db.getSpace(spaceId)

  if (!space) {
    throw new Error(`Space ${spaceId} not found`)
  }

  // Delete the space's data database
  // Database name is just the space ID
  await indexedDB.deleteDatabase(spaceId)

  // Delete from space metadata
  await db.deleteSpace(spaceId)

  // If this was the current space, clear it
  if (getCurrentSpace().id === spaceId) {
    localStorage.removeItem(SPACE_ID_KEY)
    localStorage.removeItem(SPACE_NAME_KEY)
    localStorage.removeItem(SPACE_READ_ONLY_KEY)
  }
}
