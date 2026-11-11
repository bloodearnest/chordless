/**
 * A church's CCLI licence number, as kept for a space (docs/SPACES.md, "SongSelect's terms").
 * Shared by the page and the Worker, which keeps a team's number with the team and a log of its
 * changes: CCLI may ask who a team's licence is, and a record of teams using Chordless is wanted.
 */

/** The longest number kept: they are short, but the formats differ by country, so this only stops abuse */
export const MAX_LICENCE_LENGTH = 32

/**
 * A CCLI licence number as typed, tidied: spaces and a leading "#" or "CCLI" dropped. Only
 * tidied, never judged (the formats differ by country), and empty if nothing is left.
 */
export function cleanLicence(typed: string | undefined): string {
  return (typed ?? '')
    .replace(/^\s*(ccli)?\s*(licen[cs]e)?\s*(no\.?|number|#)?\s*:?/i, '')
    .replace(/\s+/g, '')
}

/** One change to a team's licence number, as the Worker logs it (nothing is ever removed from the log) */
export interface LicenceChange {
  at: string
  /** The email of the account that made the change */
  by: string
  from: string | null
  to: string | null
}

/** A team's licence number, and (for an admin) the changes made to it, oldest first */
export interface TeamLicence {
  ccliLicence: string | null
  history?: LicenceChange[]
}
