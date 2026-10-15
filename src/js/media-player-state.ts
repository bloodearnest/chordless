/**
 * What the media player remembers of itself between visits, in localStorage: whether the pads and
 * the click are on, whether it is collapsed, where it was dragged to, and the two volumes. (What
 * the user chose in its settings dialog is media-settings.ts.) Storage that is blocked or holds
 * something unreadable gives the defaults.
 */

export interface MediaPlayerState {
  padsOn: boolean
  clickOn: boolean
  collapsed: boolean
  /** How far the player was dragged from where it starts */
  position: { x: number; y: number }
  /** 0 to 1 */
  padVolume: number
  clickVolume: number
}

const STORAGE_KEYS: Record<keyof MediaPlayerState, string> = {
  padsOn: 'media-player-pads-on',
  clickOn: 'media-player-click-on',
  collapsed: 'media-player-collapsed',
  position: 'media-player-position',
  padVolume: 'pad-volume',
  clickVolume: 'click-volume',
}

function read<K extends keyof MediaPlayerState>(
  name: K,
  fallback: MediaPlayerState[K],
  valid: (value: unknown) => value is MediaPlayerState[K]
): MediaPlayerState[K] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS[name])
    if (stored === null) return fallback
    const value = JSON.parse(stored)
    return valid(value) ? value : fallback
  } catch {
    return fallback
  }
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isVolume = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= 1
const isPosition = (value: unknown): value is { x: number; y: number } => {
  const have = value as { x?: unknown; y?: unknown } | null
  return typeof have?.x === 'number' && typeof have?.y === 'number'
}

/** The remembered state, with the defaults for what was never saved: on, collapsed, not moved */
export function loadMediaPlayerState(): MediaPlayerState {
  return {
    padsOn: read('padsOn', true, isBoolean),
    clickOn: read('clickOn', true, isBoolean),
    collapsed: read('collapsed', true, isBoolean),
    position: read('position', { x: 0, y: 0 }, isPosition),
    padVolume: read('padVolume', 0.5, isVolume),
    clickVolume: read('clickVolume', 0.8, isVolume),
  }
}

export function saveMediaPlayerState<K extends keyof MediaPlayerState>(
  name: K,
  value: MediaPlayerState[K]
) {
  try {
    localStorage.setItem(STORAGE_KEYS[name], JSON.stringify(value))
  } catch {
    // Not remembered: the player works the same
  }
}
