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

import type { SectionState } from './data-types.ts'

/** One song's preferences, by section index */
export interface SongUserPrefs {
  capo?: number
  sectionDefaults?: Record<string, SectionState>
}

/**
 * Get user preferences for a specific song
 * @param songId - Deterministic song ID (e.g., "ccli-12345" or "title-...")
 * @param orgId - Organisation ID
 * @returns Song preferences or null if none exist
 */
export function getSongUserPrefs(songId: string, orgId: string): SongUserPrefs | null {
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
 * @param songId - Deterministic song ID
 * @param orgId - Organisation ID
 */
export function saveSongUserPrefs(songId: string, orgId: string, prefs: SongUserPrefs) {
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
 * @param songId - Deterministic song ID
 * @param orgId - Organisation ID
 */
export function clearSongUserPrefs(songId: string, orgId: string) {
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
 * @param orgId - Organisation ID
 * @returns All preferences, by song ID
 */
export function getAllSongUserPrefs(orgId: string): Record<string, SongUserPrefs> {
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
 * @param orgId - Organisation ID
 */
export function clearAllSongUserPrefs(orgId: string) {
  if (!orgId) return

  try {
    const key = `song-prefs-${orgId}`
    localStorage.removeItem(key)
    console.log('[SongUserPrefs] Cleared all preferences for org:', orgId)
  } catch (error) {
    console.error('[SongUserPrefs] Error clearing all preferences:', error)
  }
}
