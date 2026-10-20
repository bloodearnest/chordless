/**
 * Song User Preferences Module
 *
 * Manages per-user, per-song preferences that are NOT synced.
 * These are personal defaults for capo, section visibility, and the media player (double
 * click, pad set).
 *
 * Storage: localStorage per space
 * Key format: 'song-prefs-${spaceId}'
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
  /** The click twice per beat: true or false is this song's own choice; absent, by its tempo */
  doubleClick?: boolean
  /** The id of the pad set this song uses; absent, the one chosen for the device */
  padSetId?: string
}

/** What the media player takes from a song's preferences */
export type SongMediaPrefs = Pick<SongUserPrefs, 'doubleClick' | 'padSetId'>

/**
 * Get user preferences for a specific song
 * @param songId - Deterministic song ID (e.g., "ccli-12345" or "title-...")
 * @param spaceId - Space ID
 * @returns Song preferences or null if none exist
 */
export function getSongUserPrefs(songId: string, spaceId: string): SongUserPrefs | null {
  if (!songId || !spaceId) return null

  try {
    const key = `song-prefs-${spaceId}`
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
 * @param spaceId - Space ID
 */
export function saveSongUserPrefs(songId: string, spaceId: string, prefs: SongUserPrefs) {
  if (!songId || !spaceId) {
    console.warn('[SongUserPrefs] Cannot save: missing songId or spaceId')
    return
  }

  try {
    const key = `song-prefs-${spaceId}`
    const allPrefs = JSON.parse(localStorage.getItem(key) || '{}')

    // Merge with existing prefs
    allPrefs[songId] = {
      ...allPrefs[songId],
      ...prefs,
    }

    localStorage.setItem(key, JSON.stringify(allPrefs))
  } catch (error) {
    console.error('[SongUserPrefs] Error saving preferences:', error)
  }
}

/**
 * Set or clear one preference of a song. `undefined` clears it (back to the default), and a
 * song left with no preferences is dropped.
 */
export function setSongUserPref<K extends keyof SongUserPrefs>(
  songId: string,
  spaceId: string,
  name: K,
  value: SongUserPrefs[K] | undefined
) {
  if (!songId || !spaceId) return
  const prefs = { ...getSongUserPrefs(songId, spaceId) }
  if (value === undefined) delete prefs[name]
  else prefs[name] = value
  if (Object.keys(prefs).length === 0) {
    clearSongUserPrefs(songId, spaceId)
    return
  }
  // saveSongUserPrefs merges, so a cleared preference has to go the long way round
  try {
    const key = `song-prefs-${spaceId}`
    const allPrefs = JSON.parse(localStorage.getItem(key) || '{}')
    allPrefs[songId] = prefs
    localStorage.setItem(key, JSON.stringify(allPrefs))
  } catch (error) {
    console.error('[SongUserPrefs] Error saving preferences:', error)
  }
}

/**
 * Clear user preferences for a specific song
 * @param songId - Deterministic song ID
 * @param spaceId - Space ID
 */
export function clearSongUserPrefs(songId: string, spaceId: string) {
  if (!songId || !spaceId) return

  try {
    const key = `song-prefs-${spaceId}`
    const allPrefs = JSON.parse(localStorage.getItem(key) || '{}')
    delete allPrefs[songId]
    localStorage.setItem(key, JSON.stringify(allPrefs))
  } catch (error) {
    console.error('[SongUserPrefs] Error clearing preferences:', error)
  }
}

/**
 * Get all song preferences for the space (for debugging/export)
 * @param spaceId - Space ID
 * @returns All preferences, by song ID
 */
export function getAllSongUserPrefs(spaceId: string): Record<string, SongUserPrefs> {
  if (!spaceId) return {}

  try {
    const key = `song-prefs-${spaceId}`
    return JSON.parse(localStorage.getItem(key) || '{}')
  } catch (error) {
    console.error('[SongUserPrefs] Error loading all preferences:', error)
    return {}
  }
}

/**
 * Clear all song preferences for the space
 * @param spaceId - Space ID
 */
export function clearAllSongUserPrefs(spaceId: string) {
  if (!spaceId) return

  try {
    const key = `song-prefs-${spaceId}`
    localStorage.removeItem(key)
  } catch (error) {
    console.error('[SongUserPrefs] Error clearing all preferences:', error)
  }
}
