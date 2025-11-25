// Organisation management utilities
// Note: "Organisation" is used internally, but UI displays "Church" to users
//
// Hybrid approach:
// - Org metadata (id, name, owner, etc.) stored in OrganisationDB (IndexedDB)
// - Current org ID stored in localStorage: current-organisation-id
// - Current org NAME cached in localStorage: current-organisation-name (for sync access)

import { OrganisationDB } from './organisation-db.js'

const ORGANISATION_ID_KEY = 'current-organisation-id'
const ORGANISATION_NAME_KEY = 'current-organisation-name'
const DEFAULT_ORGANISATION_NAME = 'Personal'

let orgDB = null
let initPromise = null

/**
 * Get or initialize the organisation database
 */
async function getOrgDB() {
  // If we have a DB instance, return it
  if (orgDB) {
    return orgDB
  }

  // If initialization is in progress, wait for it
  if (initPromise) {
    await initPromise
    return orgDB
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
      initPromise = null
      throw error
    } finally {
      initPromise = null
    }
  })()

  await initPromise
  return orgDB
}

/**
 * Get the current organisation from localStorage
 * This is synchronous and reads from cached values
 * @returns {{id: string|null, name: string}} Current organisation {id, name}
 */
export function getCurrentOrganisation() {
  const id = localStorage.getItem(ORGANISATION_ID_KEY)
  const name = localStorage.getItem(ORGANISATION_NAME_KEY) || DEFAULT_ORGANISATION_NAME
  return { id, name }
}

/**
 * Ensure a current organisation exists, creating default if needed
 * Call this on app startup before using getCurrentOrganisation()
 * @returns {Promise<{id: string, name: string}>} Current organisation
 */
export async function ensureCurrentOrganisation() {
  const { id } = getCurrentOrganisation()

  // If we have an org ID, we're good
  if (id) {
    return getCurrentOrganisation()
  }

  // No org set - get or create default
  const db = await getOrgDB()
  let defaultOrg = await db.getOrganisationByName(DEFAULT_ORGANISATION_NAME)

  if (!defaultOrg) {
    // Create default organisation
    defaultOrg = await db.createOrganisation(DEFAULT_ORGANISATION_NAME)
    console.log('[Organisation] Created default organisation:', defaultOrg.id)
  }

  // Set as current
  await setCurrentOrganisation(defaultOrg.id, defaultOrg.name)
  console.log('[Organisation] Initialized with organisation:', defaultOrg.name)

  return { id: defaultOrg.id, name: defaultOrg.name }
}

/**
 * Get the full current organisation object from database
 * Use this when you need owner, members, timestamps, etc.
 * @returns {Promise<Object>} Current organisation with id, name, owner, members, etc.
 */
export async function getCurrentOrganisationFull() {
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
  }

  // No current org or org not found - create/get default
  let defaultOrg = await db.getOrganisationByName(DEFAULT_ORGANISATION_NAME)

  if (!defaultOrg) {
    // Create default organisation
    defaultOrg = await db.createOrganisation(DEFAULT_ORGANISATION_NAME)
    console.log('[Organisation] Created default organisation:', defaultOrg.id)
  }

  // Set as current
  await setCurrentOrganisation(defaultOrg.id, defaultOrg.name)
  return defaultOrg
}

/**
 * Set the current organisation by ID
 * Also caches the name in localStorage for synchronous access
 * @param {string} organisationId - ID of organisation to set as current
 * @param {string} organisationName - Name of organisation (optional, will fetch if not provided)
 */
export async function setCurrentOrganisation(organisationId, organisationName = null) {
  localStorage.setItem(ORGANISATION_ID_KEY, organisationId)

  // Cache the name if provided
  if (organisationName) {
    localStorage.setItem(ORGANISATION_NAME_KEY, organisationName)
  } else {
    // Fetch the name if not provided
    try {
      const db = await getOrgDB()
      const org = await db.getOrganisation(organisationId)
      if (org) {
        localStorage.setItem(ORGANISATION_NAME_KEY, org.name)
      }
    } catch (error) {
      console.error('[Organisation] Failed to fetch org name:', error)
    }
  }
}

/**
 * Switch to a different organisation (saves ID and reloads app)
 * @param {string} organisationId - ID of organisation to switch to
 */
export async function switchOrganisation(organisationId) {
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

  window.location.reload()
}

/**
 * Get all organisations
 * @returns {Promise<Array>} Array of organisation objects
 */
export async function listOrganisations() {
  const db = await getOrgDB()
  return await db.getAllOrganisations()
}

/**
 * Create a new organisation
 * @param {string} name - Name of the organisation
 * @returns {Promise<Object>} Created organisation object
 */
export async function createOrganisation(name) {
  const db = await getOrgDB()
  return await db.createOrganisation(name)
}

/**
 * Rename an organisation
 * Updates the name in the database (ID stays the same, so no data migration needed!)
 * @param {string} organisationId - ID of organisation to rename
 * @param {string} newName - New name for the organisation
 * @returns {Promise<Object>} Updated organisation object
 */
export async function renameOrganisation(organisationId, newName) {
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
 * @param {string} name - Organisation name
 * @returns {Promise<Object|null>} Organisation object or null
 */
export async function getOrganisationByName(name) {
  const db = await getOrgDB()
  return await db.getOrganisationByName(name)
}

/**
 * Delete an organisation and its data database
 * WARNING: This is destructive and cannot be undone
 * @param {string} organisationId - ID of organisation to delete
 */
export async function deleteOrganisation(organisationId) {
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
  }
}
