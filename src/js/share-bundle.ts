/**
 * The bundle a share link carries (docs/SHARING.md): one setlist with its charts, and nothing
 * about the organisation. Pure: no storage, no network.
 */

import type { Setlist, SetlistEntry } from './data-types.ts'

export const SHARE_FORMAT = 'chordless-share'
export const SHARE_VERSION = 1

/** How long a share outlives its setlist's date */
export const SHARE_DAYS_AFTER = 14

export interface ShareSong {
  title: string
  /** The key this setlist plays it in */
  key: string | null
  tempo: number | null
  notes: string
  /** The chart's text, including this setlist's edits to it */
  chordpro: string
}

export interface ShareBundle {
  format: typeof SHARE_FORMAT
  version: number
  /** YYYY-MM-DD */
  expires: string
  /** ISO time the bundle was built: not part of its hash */
  updated: string
  setlist: {
    date: string
    time: string
    type: string
    name: string
    owner: string
    songs: ShareSong[]
  }
}

/** A setlist entry with what the bundle needs from the song it points at */
export interface ShareSource {
  entry: SetlistEntry
  title: string
  /** The song's own key, for an entry that doesn't set one */
  songKey: string | null
  /** The song's own tempo, for an entry that doesn't set one */
  songTempo?: number | null
  /** The song's chart text, unless the entry has its own edited copy */
  chordpro: string
}

/** A YYYY-MM-DD plus whole days, as a YYYY-MM-DD (calendar arithmetic, no time zones) */
export function addDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${date}`)
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days)
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * When a share ends: two weeks after the setlist's date, or two weeks after the share was
 * made if that is later (a set shared after its date). Recalculate when the date changes.
 */
export function shareExpiry(setlistDate: string, created: string): string {
  const fromDate = addDays(setlistDate, SHARE_DAYS_AFTER)
  const fromCreated = addDays(created, SHARE_DAYS_AFTER)
  return fromDate > fromCreated ? fromDate : fromCreated
}

/** Whether a share has ended: `today` is a YYYY-MM-DD, and the day of `expires` still counts */
export function isExpired(expires: string, today: string): boolean {
  return today > expires
}

/** The bundle for a setlist. Leaves out ids, the organisation, emails and sync fields. */
export function buildShareBundle(
  setlist: Pick<Setlist, 'date' | 'time' | 'type' | 'name' | 'owner'>,
  sources: ShareSource[],
  { expires, updated = new Date().toISOString() }: { expires: string; updated?: string }
): ShareBundle {
  const songs = [...sources]
    .sort((a, b) => a.entry.order - b.entry.order)
    .map(({ entry, title, songKey, songTempo, chordpro }) => ({
      title,
      key: entry.key ?? songKey,
      tempo: entry.tempo ?? songTempo ?? null,
      notes: entry.notes ?? '',
      chordpro: entry.chordproEdits ?? chordpro,
    }))
  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    expires,
    updated,
    setlist: {
      date: setlist.date,
      time: setlist.time ?? '',
      type: setlist.type ?? '',
      name: setlist.name ?? '',
      owner: setlist.owner ?? '',
      songs,
    },
  }
}

/** A hash of what a recipient would see: changes when the content does, and not otherwise */
export async function bundleHash(bundle: ShareBundle): Promise<string> {
  const { updated: _updated, ...content } = bundle
  const bytes = new TextEncoder().encode(JSON.stringify(content))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** Check decrypted data is a bundle this version can show. Throws if not. */
export function parseShareBundle(data: unknown): ShareBundle {
  if (!isRecord(data) || data.format !== SHARE_FORMAT) throw new Error('Not a Chordless share')
  if (typeof data.version !== 'number' || data.version > SHARE_VERSION) {
    throw new Error('This share needs a newer Chordless')
  }
  const { setlist, expires } = data
  if (typeof expires !== 'string' || !isRecord(setlist) || !Array.isArray(setlist.songs)) {
    throw new Error('The share is damaged')
  }
  for (const song of setlist.songs) {
    if (!isRecord(song) || typeof song.title !== 'string' || typeof song.chordpro !== 'string') {
      throw new Error('The share is damaged')
    }
  }
  return data as unknown as ShareBundle
}
