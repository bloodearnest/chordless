/**
 * What differs between two versions of a setlist, in words, for a message: the songs added and
 * removed, a different order, and a song's key, tempo or notes. Pure, so a setlist that arrives some
 * other way (a future live push from the leader) can be described the same way.
 */
import type { Setlist, SetlistEntry } from '../data-types.ts'

/** A song's notes as one string, so the same notes in any order are the same */
const notesOf = (entry: SetlistEntry) =>
  JSON.stringify([
    entry.notes ?? '',
    (entry.annotations ?? [])
      .map(note => [note.id, JSON.stringify(note.anchor), note.body.text])
      .sort(),
  ])

const DETAILS = ['date', 'time', 'type', 'name', 'leaderId'] as const

/** A song is the same song whichever chart (variant) the setlist uses of it */
const keyOf = (entry: SetlistEntry) => entry.songId

/**
 * What `after` has that `before` does not, as short phrases: "+ Song" (added), "− Song"
 * (removed), "order changed", "Song: key G → A", "Song: 90 → 100 BPM", "Song: notes changed",
 * "details changed".
 * Empty if the two are the same.
 */
export function describeSetlistChange(
  before: Setlist,
  after: Setlist,
  titleOf: (entry: SetlistEntry) => string
): string[] {
  const changes: string[] = []
  const was = new Map(before.songs.map(entry => [keyOf(entry), entry]))
  const now = new Map(after.songs.map(entry => [keyOf(entry), entry]))

  for (const entry of after.songs) if (!was.has(keyOf(entry))) changes.push(`+ ${titleOf(entry)}`)
  for (const entry of before.songs) if (!now.has(keyOf(entry))) changes.push(`− ${titleOf(entry)}`)

  const common = (entries: SetlistEntry[], other: Map<string, SetlistEntry>) =>
    entries.filter(entry => other.has(keyOf(entry))).map(keyOf)
  if (common(before.songs, now).join('\n') !== common(after.songs, was).join('\n')) {
    changes.push('order changed')
  }

  for (const entry of after.songs) {
    const earlier = was.get(keyOf(entry))
    if (!earlier) continue
    if ((earlier.key ?? null) !== (entry.key ?? null)) {
      changes.push(`${titleOf(entry)}: key ${earlier.key ?? '—'} → ${entry.key ?? '—'}`)
    }
    if ((earlier.tempo ?? null) !== (entry.tempo ?? null)) {
      changes.push(`${titleOf(entry)}: ${earlier.tempo ?? '—'} → ${entry.tempo ?? '—'} BPM`)
    }
    if (notesOf(earlier) !== notesOf(entry)) changes.push(`${titleOf(entry)}: notes changed`)
  }

  if (DETAILS.some(field => (before[field] ?? '') !== (after[field] ?? ''))) {
    changes.push('details changed')
  }
  return changes
}
