/**
 * A setlist session (docs/OBSERVABILITY.md, Sessions): from opening a setlist to leaving it or
 * closing the tab. Not an engagement visit with an idle timeout: this app has no use for one.
 * The session's id rides on every span while it lasts (context.ts), and two short spans mark its
 * ends: `chordless.setlist.open` and `chordless.setlist.leave`, which carries what happened between
 * as counters. Going live keeps one id across a reload, so a service is one session.
 */
import { getLive } from '../live.ts'
import { getTelemetryPreference } from '../preferences.ts'
import { clearSetlist, setAmbient } from './context.ts'
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
}

interface Session {
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
    startedAt: performance.now(),
    viewed: new Set(),
    songChanges: 0,
    transposes: 0,
    editEntries: 0,
    index: -1,
  }
  setAmbient({
    sessionId: newSessionId(),
    setlistId: opened.setlistId,
    setlistDate: opened.date,
  })
  // (the tab being closed or the page reloaded is leaving too)
  // (capturing, so that it comes before the SDK's own flush on pagehide: the leave span goes with it)
  window.addEventListener('pagehide', endSetlistSession, { capture: true })
  recordSpan('chordless.setlist.open', {
    'chordless.setlist.songs': opened.songs,
    'chordless.setlist.ccli': opened.ccli.join(','),
    'chordless.setlist.source': opened.source,
    'chordless.setlist.open_ms': Math.round(opened.openMs),
  })
}

export interface SongInView {
  /** The song's own id (`ccli-<number>`, or from its title) */
  songId: string
  ccli: string | null
  index: number
  /** The key it is shown in, after transposing */
  key: string | undefined
}

/** The song in view changed (null: the overview, which is no song). Showing the same one again is not a change */
export function songShown(song: SongInView | null): void {
  if (!session) return
  if (!song) {
    session.index = -1
    setAmbient({ songId: undefined, songCcli: undefined, songIndex: undefined, songKey: undefined })
    return
  }
  if (song.index !== session.index) session.songChanges++
  session.index = song.index
  session.viewed.add(song.songId)
  setAmbient({
    songId: song.songId,
    songCcli: song.ccli ?? undefined,
    songIndex: song.index,
    songKey: song.key,
  })
}

/** The song in view was put in another key */
export function songTransposed(key: string): void {
  if (!session) return
  session.transposes++
  setAmbient({ songKey: key })
}

/** Edit mode was turned on */
export function editModeEntered(): void {
  if (session) session.editEntries++
}

/** The setlist was left: its session ends, with what happened in it */
export function endSetlistSession(): void {
  window.removeEventListener('pagehide', endSetlistSession, { capture: true })
  if (!session) return
  const ended = session
  session = null
  recordSpan('chordless.setlist.leave', {
    'chordless.setlist.session_ms': Math.round(performance.now() - ended.startedAt),
    'chordless.setlist.songs_viewed': ended.viewed.size,
    'chordless.setlist.song_changes': ended.songChanges,
    'chordless.setlist.transposes': ended.transposes,
    'chordless.setlist.edit_entries': ended.editEntries,
  })
  clearSetlist()
}
