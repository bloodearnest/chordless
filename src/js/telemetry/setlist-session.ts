/**
 * A setlist session (docs/OBSERVABILITY.md, Sessions): from opening a setlist to leaving it or
 * closing the tab. Not an engagement visit with an idle timeout: this app has no use for one.
 * The session's id rides on every span while it lasts (context.ts), and two short spans mark its
 * ends: `chordless.setlist.open` and `chordless.setlist.leave`, which carries what happened between
 * as counters. The setlist and the song are on those spans, not on every span: a background sync is
 * not about the song on screen. Going live keeps one id across a reload, so a service is one session.
 */
import { getLive } from '../live.ts'
import { getTelemetryPreference } from '../preferences.ts'
import { setAmbient } from './context.ts'
import { getDeviceId } from './ids.ts'
import { recordSpan } from './telemetry.ts'

export interface SetlistOpened {
  setlistId: string
  /** YYYY-MM-DD */
  date: string
  songs: number
  /** The CCLI numbers of the songs that have one */
  ccli: string[]
  /** From the library, or received by a share link */
  source: 'library' | 'share'
  /** How long the setlist took to show, in ms */
  openMs: number
  /** Whether changes made here have not been sent to the storage yet (see AutoSync.hasUnsent) */
  hasUnsent: () => boolean
}

interface Session {
  setlistId: string
  date: string
  hasUnsent: () => boolean
  startedAt: number
  viewed: Set<string>
  songChanges: number
  transposes: number
  editEntries: number
  /** The index of the song in view, -1 for the overview */
  index: number
}

let session: Session | null = null

/** One id for the whole of a live service, even across a reload; any other session is a new one */
function newSessionId(): string {
  const live = getLive()
  if (live) return `${getDeviceId()?.slice(0, 8) ?? 'device'}-live-${live.startedAt}`
  return crypto.randomUUID()
}

/** A setlist has been opened: its session begins (the one before it, if the page was not left, ends) */
export function startSetlistSession(opened: SetlistOpened): void {
  endSetlistSession()
  if (!getTelemetryPreference()) return
  session = {
    setlistId: opened.setlistId,
    date: opened.date,
    hasUnsent: opened.hasUnsent,
    startedAt: performance.now(),
    viewed: new Set(),
    songChanges: 0,
    transposes: 0,
    editEntries: 0,
    index: -1,
  }
  setAmbient({ sessionId: newSessionId() })
  // (the tab being closed or the page reloaded is leaving too)
  // (capturing, so that it comes before the SDK's own flush on pagehide: the leave span goes with it)
  window.addEventListener('pagehide', endOnPageHide, { capture: true })
  recordSpan('chordless.setlist.open', {
    'chordless.setlist.id': opened.setlistId,
    'chordless.setlist.date': opened.date,
    'chordless.setlist.songs': opened.songs,
    'chordless.setlist.ccli': opened.ccli.join(','),
    'chordless.setlist.source': opened.source,
    'chordless.setlist.open_ms': Math.round(opened.openMs),
  })
}

export interface SongInView {
  /** The song's own id (`ccli-<number>`, or from its title) */
  songId: string
  index: number
}

/** The song in view changed (null: the overview, which is no song). Showing the same one again is not a change */
export function songShown(song: SongInView | null): void {
  if (!session) return
  if (!song) {
    session.index = -1
    return
  }
  if (song.index !== session.index) session.songChanges++
  session.index = song.index
  session.viewed.add(song.songId)
}

/** The song in view was put in another key */
export function songTransposed(): void {
  if (session) session.transposes++
}

/** Edit mode was turned on */
export function editModeEntered(): void {
  if (session) session.editEntries++
}

function endOnPageHide(): void {
  endSetlistSession('page')
}

/**
 * The setlist was left: its session ends, with what happened in it. `left` says how: the page went
 * (the tab closed, the app put away, a reload), or the app moved to another page and carries on.
 * Changes still unsent when the page goes may wait for the next time it is opened; when the app
 * carries on, they are sent in a moment.
 */
export function endSetlistSession(left: 'page' | 'navigation' = 'navigation'): void {
  window.removeEventListener('pagehide', endOnPageHide, { capture: true })
  if (!session) return
  const ended = session
  session = null
  recordSpan('chordless.setlist.leave', {
    'chordless.setlist.id': ended.setlistId,
    'chordless.setlist.date': ended.date,
    'chordless.setlist.session_ms': Math.round(performance.now() - ended.startedAt),
    'chordless.setlist.left': left,
    'chordless.setlist.unsent_on_leave': ended.hasUnsent(),
    'chordless.setlist.songs_viewed': ended.viewed.size,
    'chordless.setlist.song_changes': ended.songChanges,
    'chordless.setlist.transposes': ended.transposes,
    'chordless.setlist.edit_entries': ended.editEntries,
  })
  setAmbient({ sessionId: undefined })
}
