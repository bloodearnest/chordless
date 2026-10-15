// Organisation management utilities
// Note: "Organisation" is used internally, but UI displays "Church" to users
//
// Hybrid approach:
// - Org metadata (id, name, owner, etc.) stored in OrganisationDB (IndexedDB)
// - Current org ID stored in localStorage: current-organisation-id
// - Current org NAME cached in localStorage: current-organisation-name (for sync access)

import type { Organisation } from './data-types.ts'
import { OrganisationDB } from './organisation-db.ts'

const ORGANISATION_ID_KEY = 'current-organisation-id'
const ORGANISATION_NAME_KEY = 'current-organisation-name'
const ORGANISATION_READ_ONLY_KEY = 'current-organisation-read-only'
const DEFAULT_ORGANISATION_NAME = 'Personal'

let orgDB: OrganisationDB | null = null
let initPromise: Promise<OrganisationDB> | null = null

/**
 * Get or initialize the organisation database
 */
async function getOrgDB(): Promise<OrganisationDB> {
  // If we have a DB instance, return it
  if (orgDB) {
    return orgDB
  }

  // If initialization is in progress, wait for it
  if (initPromise) {
    return initPromise
  }

  // Start initialization
  initPromise = (async () => {
    try {
      const db = new OrganisationDB()
      await db.init()
      orgDB = db
      return db
    } catch (error) {
      console.error('[Organisation] Failed to initialize OrganisationDB:', error)
      throw error
    } finally {
      initPromise = null
    }
  })()

  return initPromise
}

/**
 * Get the current organisation from localStorage
 * This is synchronous and reads from cached values
 * @returns Current organisation {id, name}
 */
export function getCurrentOrganisation(): { id: string | null; name: string } {
  const id = localStorage.getItem(ORGANISATION_ID_KEY)
  const name = localStorage.getItem(ORGANISATION_NAME_KEY) || DEFAULT_ORGANISATION_NAME
  return { id, name }
}

/**
 * Whether the user can only read the current organisation's Drive folder (known after a sync
 * has asked Drive). Then nothing that syncs is edited here: no setlist or song edits, imports
 * or share links; the user's own state (capo, shown sections) is still kept on the device.
 * Read from localStorage, so it can be asked at any moment.
 */
export function isReadOnlyOrganisation(): boolean {
  return localStorage.getItem(ORGANISATION_READ_ONLY_KEY) === '1'
}

/** Record that the user can (or can only read) an organisation's Drive folder */
export async function setOrganisationReadOnly(
  organisationId: string,
  readOnly: boolean
): Promise<void> {
  const db = await getOrgDB()
  const organisation = await db.getOrganisation(organisationId)
  if (organisation && Boolean(organisation.readOnly) !== readOnly) {
    await db.updateOrganisation(organisationId, { readOnly })
  }
  if (getCurrentOrganisation().id === organisationId) {
    const changed = isReadOnlyOrganisation() !== readOnly
    cacheReadOnly(readOnly)
    // So what shows edits can follow (read-only-controller.ts)
    if (changed) window.dispatchEvent(new Event('organisation-read-only-change'))
  }
}

function cacheReadOnly(readOnly: boolean): void {
  if (readOnly) localStorage.setItem(ORGANISATION_READ_ONLY_KEY, '1')
  else localStorage.removeItem(ORGANISATION_READ_ONLY_KEY)
}

let defaultOrganisationPromise: Promise<Organisation> | null = null

/**
 * The default organisation, created if there isn't one. Callers at the same
 * time share one attempt, so it's only created once; and if another page (or
 * tab) creates it first, it's read back rather than failing on the name.
 */
function getOrCreateDefaultOrganisation(): Promise<Organisation> {
  defaultOrganisationPromise ??= (async () => {
    const db = await getOrgDB()
    const existing = await db.getOrganisationByName(DEFAULT_ORGANISATION_NAME)
    if (existing) return existing
    try {
      const created = await db.createOrganisation(DEFAULT_ORGANISATION_NAME)
      console.log('[Organisation] Created default organisation:', created.id)
      return created
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'ConstraintError') throw error
      const found = await db.getOrganisationByName(DEFAULT_ORGANISATION_NAME)
      if (!found) throw error
      return found
    }
  })().finally(() => {
    defaultOrganisationPromise = null
  })
  return defaultOrganisationPromise
}

/**
 * Ensure a current organisation exists, creating default if needed
 * Call this on app startup before using getCurrentOrganisation()
 * @returns Current organisation
 */
export async function ensureCurrentOrganisation(): Promise<{ id: string; name: string }> {
  const { id, name } = getCurrentOrganisation()

  // If we have an org ID, we're good
  if (id) {
    return { id, name }
  }

  // No org set - get or create default
  const defaultOrg = await getOrCreateDefaultOrganisation()

  // Set as current
  await setCurrentOrganisation(defaultOrg.id, defaultOrg.name)
  console.log('[Organisation] Initialized with organisation:', defaultOrg.name)

  return { id: defaultOrg.id, name: defaultOrg.name }
}

/**
 * Get the full current organisation object from database
 * Use this when you need owner, members, timestamps, etc.
 * @returns Current organisation with id, name, members, etc.
 */
export async function getCurrentOrganisationFull(): Promise<Organisation> {
  const db = await getOrgDB()
  const { id } = getCurrentOrganisation()

  if (id) {
    const org = await db.getOrganisation(id)
    if (org) {
      // Update name cache in case it changed
      localStorage.setItem(ORGANISATION_NAME_KEY, org.name)
      return org
    }
    // ID exists but org not found - clear stale data
    console.warn('[Organisation] Stored org ID not found, creating default:', id)
    localStorage.removeItem(ORGANISATION_ID_KEY)
    localStorage.removeItem(ORGANISATION_NAME_KEY)
    localStorage.removeItem(ORGANISATION_READ_ONLY_KEY)
  }

  // No current org or org not found - create/get default
  const defaultOrg = await getOrCreateDefaultOrganisation()

  // Set as current
  await setCurrentOrganisation(defaultOrg.id, defaultOrg.name)
  return defaultOrg
}

/**
 * Set the current organisation by ID
 * Also caches the name in localStorage for synchronous access
 * @param organisationId - ID of organisation to set as current
 * @param organisationName - Name of organisation (optional, will fetch if not provided)
 */
export async function setCurrentOrganisation(
  organisationId: string,
  organisationName: string | null = null
): Promise<void> {
  localStorage.setItem(ORGANISATION_ID_KEY, organisationId)

  // Cache the name if provided, and whether the folder is read-only
  if (organisationName) localStorage.setItem(ORGANISATION_NAME_KEY, organisationName)
  try {
    const org = await (await getOrgDB()).getOrganisation(organisationId)
    if (org && !organisationName) localStorage.setItem(ORGANISATION_NAME_KEY, org.name)
    cacheReadOnly(Boolean(org?.readOnly))
  } catch (error) {
    console.error('[Organisation] Failed to read the organisation:', error)
  }
}

/**
 * Switch to a different organisation (saves ID and reloads app)
 * @param organisationId - ID of organisation to switch to
 * @param reload - starts the app afresh (the page reloads: a test gives its own)
 */
export async function switchOrganisation(
  organisationId: string,
  // biome-ignore lint/plugin: the database is another organisation's now, so start afresh
  reload: () => void = () => window.location.reload()
): Promise<void> {
  // Get the org to cache its name
  try {
    const db = await getOrgDB()
    const org = await db.getOrganisation(organisationId)
    if (org) {
      await setCurrentOrganisation(organisationId, org.name)
    } else {
      await setCurrentOrganisation(organisationId)
    }
  } catch (error) {
    console.error('[Organisation] Error switching org:', error)
    await setCurrentOrganisation(organisationId)
  }

  reload()
}

/**
 * Get all organisations
 */
export async function listOrganisations(): Promise<Organisation[]> {
  const db = await getOrgDB()
  return await db.getAllOrganisations()
}

/**
 * Create a new organisation
 * @param name - Name of the organisation
 * @returns Created organisation object
 */
export async function createOrganisation(name: string): Promise<Organisation> {
  const db = await getOrgDB()
  return await db.createOrganisation(name)
}

/**
 * Rename an organisation
 * Updates the name in the database (ID stays the same, so no data migration needed!)
 * @param organisationId - ID of organisation to rename
 * @param newName - New name for the organisation
 * @returns Updated organisation object
 */
export async function renameOrganisation(
  organisationId: string,
  newName: string
): Promise<Organisation> {
  const db = await getOrgDB()

  // Get current org
  const org = await db.getOrganisation(organisationId)
  if (!org) {
    throw new Error(`Organisation ${organisationId} not found`)
  }

  // Check if new name already exists
  const existing = await db.getOrganisationByName(newName)
  if (existing && existing.id !== organisationId) {
    throw new Error(`Organisation "${newName}" already exists`)
  }

  // Update the name (updateOrganisation expects (id, updates))
  const updated = await db.updateOrganisation(organisationId, { name: newName })

  // Update name cache if this is the current org
  if (getCurrentOrganisation().id === organisationId) {
    localStorage.setItem(ORGANISATION_NAME_KEY, newName)
  }

  console.log(`[Organisation] Renamed organisation ${organisationId} to "${newName}"`)
  return updated
}

/**
 * Get organisation by name
 * @param name - Organisation name
 * @returns Organisation object, if there is one
 */
export async function getOrganisationByName(name: string): Promise<Organisation | undefined> {
  const db = await getOrgDB()
  return await db.getOrganisationByName(name)
}

/**
 * Delete an organisation and its data database
 * WARNING: This is destructive and cannot be undone
 * @param organisationId - ID of organisation to delete
 */
export async function deleteOrganisation(organisationId: string): Promise<void> {
  const db = await getOrgDB()
  const org = await db.getOrganisation(organisationId)

  if (!org) {
    throw new Error(`Organisation ${organisationId} not found`)
  }

  // Delete the organisation's data database
  // Database name is just the org ID
  await indexedDB.deleteDatabase(organisationId)
  console.log(`[Organisation] Deleted database: ${organisationId}`)

  // Delete from organisation metadata
  await db.deleteOrganisation(organisationId)

  // If this was the current org, clear it
  if (getCurrentOrganisation().id === organisationId) {
    localStorage.removeItem(ORGANISATION_ID_KEY)
    localStorage.removeItem(ORGANISATION_NAME_KEY)
    localStorage.removeItem(ORGANISATION_READ_ONLY_KEY)
  }
}
