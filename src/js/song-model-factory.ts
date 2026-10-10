import type { LoadedSong, SectionState, SetlistEntry } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { LibrarySong } from './models/library-song.ts'
import { SetlistSong } from './models/setlist-song.ts'
import type { SongModel } from './models/song-model.ts'
import type { RuntimeSong } from './setlist/runtime-songs.ts'

/**
 * Factory for creating SongModel instances from runtime song data
 *
 * This provides a bridge between the current runtime song objects
 * and the new SongModel abstraction for persistence.
 */

/**
 * Create a SetlistSong model for a song in a setlist
 *
 * @param runtimeSong - Runtime song object from this.songs[]
 * @param setlistEntry - Entry from setlist.songs[]
 * @param canonicalSong - Full canonical song with parsed content
 * @param setlistId - Setlist ID
 * @param db - Database instance
 * @param orgId - Organisation ID
 */
export function createSetlistSongModel(
  runtimeSong: RuntimeSong,
  setlistEntry: SetlistEntry,
  canonicalSong: LoadedSong,
  setlistId: string,
  db: ChordlessDB,
  orgId: string
): SetlistSong {
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
 * @param fullSong - Full song object with parsed content
 * @param db - Database instance
 * @param orgId - Organisation ID
 */
export function createLibrarySongModel(
  fullSong: LoadedSong,
  db: ChordlessDB,
  orgId: string
): LibrarySong {
  return new LibrarySong(fullSong, db, orgId)
}

/**
 * Sync section states from app into model
 *
 * @param model - Song model instance
 * @param sectionState - Section state from app { sectionIndex: {hideMode, isCollapsed, isHidden} }
 */
export function syncSectionStates(
  model: SongModel,
  sectionState: Record<string, SectionState> | null | undefined
): void {
  if (!sectionState) return

  for (const [sectionIndex, state] of Object.entries(sectionState)) {
    model.setSectionState(Number(sectionIndex), state)
  }
}
