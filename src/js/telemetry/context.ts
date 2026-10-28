/**
 * What the app knows of where it is, for the reports to carry (docs/OBSERVABILITY.md, "On every
 * browser span"): the setlist and song in view, the session, and the ids. Kept in memory and read
 * as each span starts, so no call site has to remember to add them. It is not trace context: a
 * browser has no async context, and these are the app's state, not a span's parent.
 */

export interface Ambient {
  /** A setlist session: made when a setlist opens, gone when it is left */
  sessionId?: string
  setlistId?: string
  setlistDate?: string
  songId?: string
  songCcli?: string
  songIndex?: number
  /** The key the song is shown in, after transposing: never its title */
  songKey?: string
  spaceKind?: string
  /** Random ids kept in the person's own synced data, never derived from who they are */
  accountId?: string
  teamPseudoId?: string
}

let ambient: Ambient = {}

export const getAmbient = (): Readonly<Ambient> => ambient

/** Add to what is known, or replace a value (a key set to undefined is removed) */
export function setAmbient(patch: Ambient): void {
  ambient = { ...ambient, ...patch }
  for (const key of Object.keys(ambient) as (keyof Ambient)[]) {
    if (ambient[key] === undefined) delete ambient[key]
  }
}

const SETLIST_KEYS = [
  'sessionId',
  'setlistId',
  'setlistDate',
  'songId',
  'songCcli',
  'songIndex',
  'songKey',
] as const satisfies (keyof Ambient)[]

/** Forget what is known of a setlist and its song (it was left), keeping the rest */
export function clearSetlist(): void {
  ambient = { ...ambient }
  for (const key of SETLIST_KEYS) delete ambient[key]
}
