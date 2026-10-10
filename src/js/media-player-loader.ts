/**
 * The media player (pads and a click track) is optional: the setlists work without
 * it. This decides whether to load it, so a device that can't run it, or where it is
 * switched off in Preferences, doesn't download or run its code, and a failure to
 * load it leaves the rest of the app alone.
 *
 * It is a matter of what the device can do and what the user chose, not of which
 * browser version it is: there is no way to tell a slow iPad from a fast one, but
 * Preferences has a switch for the player.
 */
import { loadMediaSettings } from './media-settings.ts'

/** What is needed of the window to tell whether it can play audio */
interface AudioCapable {
  AudioContext?: unknown
  webkitAudioContext?: unknown
}

interface LoaderOptions {
  win?: AudioCapable
  storage?: Pick<Storage, 'getItem'>
}

/** Whether this browser has the Web Audio the player is built on */
export function canPlayAudio(win: AudioCapable = window as AudioCapable): boolean {
  return Boolean(win.AudioContext || win.webkitAudioContext)
}

/** Whether the player should be loaded: the device can play audio, and it's switched on */
export function wantsMediaPlayer({
  win = window as AudioCapable,
  storage = localStorage,
}: LoaderOptions = {}): boolean {
  return canPlayAudio(win) && loadMediaSettings(storage).mediaPlayerEnabled
}

/** Whether pads should be fetched for songs: the player is wanted and its pads are on */
export function wantsPads({
  win = window as AudioCapable,
  storage = localStorage,
}: LoaderOptions = {}): boolean {
  return wantsMediaPlayer({ win, storage }) && loadMediaSettings(storage).padsEnabled
}

/**
 * Load the player's module, whatever happens to it: a module that fails to load or run
 * (an old browser that can't parse it) is a warning, not an error.
 * @returns whether it loaded
 */
export async function loadMediaPlayer(
  load: () => Promise<unknown> = () => import('../components/media-player.ts')
): Promise<boolean> {
  try {
    await load()
    return true
  } catch (error) {
    console.warn('[MediaPlayer] Not available on this device:', error)
    return false
  }
}

/**
 * Load the player if it is wanted; if it is switched on later in Preferences, then.
 * @param options for tests
 */
export function startMediaPlayer({
  load,
  win = window as AudioCapable,
  storage = localStorage,
  doc = document,
}: LoaderOptions & {
  load?: () => Promise<unknown>
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener'>
} = {}): Promise<boolean> {
  const wanted = () => wantsMediaPlayer({ win, storage })
  if (wanted()) return loadMediaPlayer(load)

  if (canPlayAudio(win)) {
    const onChange = () => {
      if (!wanted()) return
      doc.removeEventListener('media-player-settings:change', onChange)
      loadMediaPlayer(load)
    }
    doc.addEventListener('media-player-settings:change', onChange)
  }
  return Promise.resolve(false)
}
