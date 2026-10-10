import { LibrarySong } from './models/library-song.js'
import { SetlistSong } from './models/setlist-song.js'

/**
 * Factory for creating SongModel instances from runtime song data
 *
 * This provides a bridge between the current runtime song objects
 * and the new SongModel abstraction for persistence.
 */

/**
 * Create a SetlistSong model for a song in a setlist
 *
 * @param {Object} runtimeSong - Runtime song object from this.songs[]
 * @param {Object} setlistEntry - Entry from setlist.songs[]
 * @param {Object} canonicalSong - Full canonical song with parsed content
 * @param {string} setlistId - Setlist ID
 * @param {Object} db - Database instance
 * @param {string} orgId - Organisation ID
 * @returns {SetlistSong}
 */
export function createSetlistSongModel(
  runtimeSong,
  setlistEntry,
  canonicalSong,
  setlistId,
  db,
  orgId
) {
  const songIndex = runtimeSong.songIndex

  // Create SetlistSong model
  const model = new SetlistSong(setlistEntry, canonicalSong, setlistId, db, orgId, songIndex)

  // Sync current runtime state into model (if changed from defaults)
  if (runtimeSong.currentKey && runtimeSong.currentKey !== setlistEntry.key) {
    model.setKey(runtimeSong.currentKey)
  }

  if (runtimeSong.metadata?.tempo && runtimeSong.metadata.tempo !== setlistEntry.tempo) {
    model.setTempo(runtimeSong.metadata.tempo)
  }

  if (runtimeSong.currentCapo !== undefined && runtimeSong.currentCapo !== 0) {
    model.setCapo(runtimeSong.currentCapo)
  }

  return model
}

/**
 * Create a LibrarySong model for a song in library view
 *
 * @param {Object} fullSong - Full song object with parsed content
 * @param {Object} db - Database instance
 * @param {string} orgId - Organisation ID
 * @returns {LibrarySong}
 */
export function createLibrarySongModel(fullSong, db, orgId) {
  return new LibrarySong(fullSong, db, orgId)
}

/**
 * Sync section states from app into model
 *
 * @param {SongModel} model - Song model instance
 * @param {Object} sectionState - Section state from app { sectionIndex: {hideMode, isCollapsed, isHidden} }
 */
export function syncSectionStates(model, sectionState) {
  if (!sectionState) return

  for (const [sectionIndex, state] of Object.entries(sectionState)) {
    model.setSectionState(Number(sectionIndex), state)
  }
}
