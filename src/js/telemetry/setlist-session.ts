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
import { FrameMonitor } from './frames.ts'
import { getDeviceId } from './ids.ts'
import { recordSpan } from './telemetry.ts'

export interface SetlistOpened {
  setlistId: string
  /** YYYY-MM-DD */
  date: string
  songs: number
  /** How many of the songs have a lead sheet in the space (docs/LEAD_SHEETS.md); not known if it could not be read */
  scores?: number
  /** The CCLI numbers of the songs that have one */
  ccli: string[]
  /** From the library, or received by a share link */
  source: 'library' | 'share'
  /** How long the setlist took to show, in ms */
  openMs: number
  /** Whether changes made here have not been sent to the storage yet (see AutoSync.hasUnsent) */
  hasUnsent: () => boolean
  /**
   * What drawing the setlist cost, which `openMs` does not say (it is the page's own set-up, not
   * the browser's work of laying out and painting every song). From the page being made, in ms:
   * the first paint after the songs were in the page, and every song's display ready and painted.
   * Not known if the page was hidden and no frame came.
   */
  firstPaintMs?: number
  settledMs?: number
  /** Elements in the page (the songs' shadow roots too), a measure of how much there is to lay out */
  domElements?: number
  /** How many songs were drawn at first: the ones near the one in view, not all (docs/LAZY_SONGS.md) */
  drawn?: number
}

/** The first seconds after opening, when the other songs are laid out behind the one in view */
const OPENING_MS = 10_000

interface Session {
  setlistId: string
  date: string
  hasUnsent: () => boolean
  startedAt: number
  viewed: Set<string>
  songChanges: number
  transposes: number
  editEntries: number
  /** Which frames took long (frames.ts) */
  frames: FrameMonitor
  /** The index of the song in view, -1 for the overview */
  index: number
  /** What the frames were on each song, in order: `index:long/frames@songs drawn` (see `closeStretch`) */
  stretches: string[]
  /** Where the frames stood when the last stretch closed */
  marked: { frames: number; long: number }
  /** How many songs were drawn at the last change, which the page says */
  live: number | undefined
}

/** At most this many stretches go in the report, the last ones: a long service has more songs than a span is for */
const MAX_STRETCHES = 60

let session: Session | null = null

/** A person did something: the frames that follow it are the ones that tell whether it was smooth */
function onActivity(): void {
  session?.frames.arm()
}

const ACTIVITY = ['scroll', 'pointerdown', 'keydown'] as const

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
    frames: new FrameMonitor(OPENING_MS),
    index: -1,
    stretches: [],
    marked: { frames: 0, long: 0 },
    live: undefined,
  }
  session.frames.start()
  // (scroll does not bubble: captured, it is seen from any scroller)
  for (const type of ACTIVITY) {
    window.addEventListener(type, onActivity, { capture: true, passive: true })
  }
  setAmbient({ sessionId: newSessionId() })
  // (the tab being closed or the page reloaded is leaving too)
  // (capturing, so that it comes before the SDK's own flush on pagehide: the leave span goes with it)
  window.addEventListener('pagehide', endOnPageHide, { capture: true })
  recordSpan('chordless.setlist.open', {
    ...(opened.firstPaintMs === undefined
      ? {}
      : { 'chordless.setlist.first_paint_ms': Math.round(opened.firstPaintMs) }),
    ...(opened.settledMs === undefined
      ? {}
      : { 'chordless.setlist.settled_ms': Math.round(opened.settledMs) }),
    ...(opened.domElements === undefined
      ? {}
      : { 'chordless.setlist.dom_elements': opened.domElements }),
    ...(opened.drawn === undefined ? {} : { 'chordless.setlist.drawn': opened.drawn }),
    'chordless.setlist.id': opened.setlistId,
    'chordless.setlist.date': opened.date,
    'chordless.setlist.songs': opened.songs,
    ...(opened.scores === undefined ? {} : { 'chordless.setlist.scores': opened.scores }),
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

/**
 * The frames since the last change belong to the song that was in view (the overview is -1): say
 * how many were long, of how many, and how many songs were drawn then. A page that slows towards
 * the end of a long setlist shows in the order of these (a stretch with no frame measured is left out).
 */
function closeStretch(open: Session): void {
  const { frames, long } = open.frames.total
  const measured = frames - open.marked.frames
  if (measured > 0) {
    const live = open.live === undefined ? '' : `@${open.live}`
    open.stretches.push(`${open.index}:${long - open.marked.long}/${measured}${live}`)
  }
  open.marked = { frames, long }
}

/**
 * The song in view changed (null: the overview, which is no song). Showing the same one again is not
 * a change. `drawn` is how many songs are drawn now, where the page says (docs/LAZY_SONGS.md).
 */
export function songShown(song: SongInView | null, drawn?: number): void {
  if (!session) return
  const index = song ? song.index : -1
  if (index !== session.index) {
    closeStretch(session)
    if (song) session.songChanges++
  }
  if (drawn !== undefined) session.live = drawn
  session.index = index
  if (song) session.viewed.add(song.songId)
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
  for (const type of ACTIVITY) window.removeEventListener(type, onActivity, { capture: true })
  if (!session) return
  const ended = session
  session = null
  closeStretch(ended)
  const { opening, total } = ended.frames.stop()
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
    // (frames.ts: the frames that took 50 ms or more, in the first seconds and in the moments
    // after a scroll, a tap or a key; none if nothing was measured)
    ...(total.frames === 0
      ? {}
      : {
          'chordless.perf.frames': total.frames,
          'chordless.perf.long_frames': total.long,
          'chordless.perf.long_frame_ms': Math.round(total.longMs),
          'chordless.perf.worst_frame_ms': Math.round(total.worstMs),
          'chordless.perf.open_frames': opening.frames,
          'chordless.perf.open_long_frames': opening.long,
          'chordless.perf.open_worst_frame_ms': Math.round(opening.worstMs),
        }),
    // (in the order of the songs seen: where a long setlist begins to be slow)
    ...(ended.stretches.length === 0
      ? {}
      : { 'chordless.perf.by_song': ended.stretches.slice(-MAX_STRETCHES).join(',') }),
  })
  setAmbient({ sessionId: undefined })
}
