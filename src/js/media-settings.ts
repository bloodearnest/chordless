/**
 * Global media player settings, kept in localStorage.
 *
 * media-player-settings edits them and fires settings-change (bubbling and
 * composed, so it reaches the document); media-player reads them at start and
 * listens for that event.
 */

const KEY = 'media-settings'
// Written by older versions of the media player's own settings dialog
const OLD_KEY = 'mediaPlayerSettings'

export interface MediaSettings {
  mediaPlayerEnabled: boolean
  padsEnabled: boolean
  metronomeEnabled: boolean
  stereoSplitEnabled: boolean
  /** Click louder on the downbeat; off, every click sounds like an off-beat one */
  emphasiseDownbeat: boolean
  /** Click twice per beat for slow songs (see wantsDoubleClick) */
  autoDoubleClick: boolean
  /** A song at or below this BPM gets the double click */
  doubleClickBelowBpm: number
}

export const DEFAULT_DOUBLE_CLICK_BELOW_BPM = 72

/** Read the settings, filling in defaults */
export function loadMediaSettings(storage: Pick<Storage, 'getItem'> = localStorage): MediaSettings {
  let saved: Partial<MediaSettings> = {}
  try {
    saved = JSON.parse(storage.getItem(KEY) ?? storage.getItem(OLD_KEY) ?? 'null') || {}
  } catch {
    // Unreadable settings: use the defaults
  }
  return {
    mediaPlayerEnabled: saved.mediaPlayerEnabled !== false,
    padsEnabled: saved.padsEnabled !== false,
    metronomeEnabled: saved.metronomeEnabled !== false,
    stereoSplitEnabled: saved.stereoSplitEnabled === true,
    emphasiseDownbeat: saved.emphasiseDownbeat !== false,
    autoDoubleClick: saved.autoDoubleClick !== false,
    doubleClickBelowBpm:
      typeof saved.doubleClickBelowBpm === 'number' && saved.doubleClickBelowBpm > 0
        ? saved.doubleClickBelowBpm
        : DEFAULT_DOUBLE_CLICK_BELOW_BPM,
  }
}

/**
 * Whether the click should come twice per beat: the song's own choice if it has one,
 * else automatically for slow songs (at or below the threshold), unless that is switched off
 */
export function wantsDoubleClick(
  settings: Pick<MediaSettings, 'autoDoubleClick' | 'doubleClickBelowBpm'>,
  bpm: number | null | undefined,
  songChoice?: boolean
): boolean {
  if (songChoice !== undefined) return songChoice
  return settings.autoDoubleClick && !!bpm && bpm > 0 && bpm <= settings.doubleClickBelowBpm
}

export function saveMediaSettings(
  settings: MediaSettings,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage
) {
  storage.setItem(KEY, JSON.stringify(settings))
  storage.removeItem(OLD_KEY)
}
