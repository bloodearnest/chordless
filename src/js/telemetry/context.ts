/**
 * What the app knows of itself, for every report to carry (docs/OBSERVABILITY.md, "On every
 * browser span"): the session a report happened in, and the ids. Kept in memory and read as each
 * span starts, so no call site has to remember to add them. It is not trace context: a browser has
 * no async context, and these are the app's state, not a span's parent.
 *
 * The setlist and the song in view are not here: a background sync would seem to be about the song
 * on screen. A span that is about them says so itself (setlist-session.ts).
 */

export interface Ambient {
  /** A setlist session: made when a setlist opens, gone when it is left */
  sessionId?: string
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
