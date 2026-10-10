/**
 * Song User Preferences Module
 *
 * Manages per-user, per-song preferences that are NOT synced.
 * These are personal defaults for capo and section visibility.
 *
 * Storage: localStorage per organisation
 * Key format: 'song-prefs-${orgId}'
 *
 * Structure:
 * {
 *   "song-id-1": {
 *     capo: 2,
 *     sectionDefaults: {
 *       "0": { hideMode: 'none', isCollapsed: false, isHidden: false },
 *       "1": { hideMode: 'chords', isCollapsed: false, isHidden: false }
 *     }
 *   }
 * }
 */

/**
 * Get user preferences for a specific song
 * @param {string} songId - Deterministic song ID (e.g., "ccli-12345" or "title-...")
 * @param {string} orgId - Organisation ID
 * @returns {Object|null} Song preferences or null if none exist
 */
export function getSongUserPrefs(songId, orgId) {
  if (!songId || !orgId) return null

  try {
    const key = `song-prefs-${orgId}`
    const allPrefs = JSON.parse(localStorage.getItem(key) || '{}')
    return allPrefs[songId] || null
  } catch (error) {
    console.error('[SongUserPrefs] Error loading preferences:', error)
    return null
  }
}

/**
 * Save user preferences for a specific song
 * @param {string} songId - Deterministic song ID
 * @param {string} orgId - Organisation ID
 * @param {Object} prefs - Preferences object { capo?, sectionDefaults? }
 */
export function saveSongUserPrefs(songId, orgId, prefs) {
  if (!songId || !orgId) {
    console.warn('[SongUserPrefs] Cannot save: missing songId or orgId')
    return
  }

  try {
    const key = `song-prefs-${orgId}`
    const allPrefs = JSON.parse(localStorage.getItem(key) || '{}')

    // Merge with existing prefs
    allPrefs[songId] = {
      ...allPrefs[songId],
      ...prefs,
    }

    localStorage.setItem(key, JSON.stringify(allPrefs))
    console.log('[SongUserPrefs] Saved preferences for song:', songId, prefs)
  } catch (error) {
    console.error('[SongUserPrefs] Error saving preferences:', error)
  }
}

/**
 * Clear user preferences for a specific song
 * @param {string} songId - Deterministic song ID
 * @param {string} orgId - Organisation ID
 */
export function clearSongUserPrefs(songId, orgId) {
  if (!songId || !orgId) return

  try {
    const key = `song-prefs-${orgId}`
    const allPrefs = JSON.parse(localStorage.getItem(key) || '{}')
    delete allPrefs[songId]
    localStorage.setItem(key, JSON.stringify(allPrefs))
    console.log('[SongUserPrefs] Cleared preferences for song:', songId)
  } catch (error) {
    console.error('[SongUserPrefs] Error clearing preferences:', error)
  }
}

/**
 * Get all song preferences for the organisation (for debugging/export)
 * @param {string} orgId - Organisation ID
 * @returns {Object} All preferences
 */
export function getAllSongUserPrefs(orgId) {
  if (!orgId) return {}

  try {
    const key = `song-prefs-${orgId}`
    return JSON.parse(localStorage.getItem(key) || '{}')
  } catch (error) {
    console.error('[SongUserPrefs] Error loading all preferences:', error)
    return {}
  }
}

/**
 * Clear all song preferences for the organisation
 * @param {string} orgId - Organisation ID
 */
export function clearAllSongUserPrefs(orgId) {
  if (!orgId) return

  try {
    const key = `song-prefs-${orgId}`
    localStorage.removeItem(key)
    console.log('[SongUserPrefs] Cleared all preferences for org:', orgId)
  } catch (error) {
    console.error('[SongUserPrefs] Error clearing all preferences:', error)
  }
}
