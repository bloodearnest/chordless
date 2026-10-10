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
}

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
  }
}

export function saveMediaSettings(
  settings: MediaSettings,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage
) {
  storage.setItem(KEY, JSON.stringify(settings))
  storage.removeItem(OLD_KEY)
}
