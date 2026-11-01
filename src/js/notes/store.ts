/**
 * The notes on one song as they are kept (docs/NOTES.md): three places, by where a note shows and
 * who sees it. Pure functions over those three, so a page loads and saves each as it does its
 * other state and this decides what goes where.
 *
 *   setlist + shared  the setlist's entry for the song (`annotations`; synced)
 *   setlist + private this device, in the setlist's local state
 *   song + private    this device, in the space's database, for the song in any setlist
 *
 * Song + shared would need a synced collection and is not built.
 */
import type { ChartNote, SetlistEntry, SharedChartNote } from '../data-types.ts'
import { atLeast, type TeamRole } from '../team-roles.ts'

export type NoteScope = 'setlist' | 'song'
export type NoteReach = 'private' | 'shared'

export interface NoteKind {
  scope: NoteScope
  reach: NoteReach
}

/** The default for a new note: this setlist, just me (never shared by surprise) */
export const DEFAULT_NOTE_KIND: NoteKind = { scope: 'setlist', reach: 'private' }

export interface NoteSources {
  shared: SharedChartNote[]
  setlistPrivate: ChartNote[]
  songPrivate: ChartNote[]
}

export const noSources = (): NoteSources => ({ shared: [], setlistPrivate: [], songPrivate: [] })

/** Whether a note can be shared with the team: the user can write the setlist, which is not a received share */
export function canShareNotes(
  space: { readOnly?: boolean; team?: { role: TeamRole } } | undefined,
  setlist: { received?: unknown } | undefined
): boolean {
  if (setlist?.received) return false
  if (space?.readOnly) return false
  return space?.team ? atLeast(space.team.role, 'writer') : true
}

/** Whether a note of this kind can be made at all (and so a note can be moved to it) */
export function kindAllowed(kind: NoteKind, note: ChartNote, mayShare: boolean): boolean {
  if (kind.reach === 'shared') return mayShare && kind.scope === 'setlist' && note.body.kind === 'text'
  return true
}

function listFor(sources: NoteSources, kind: NoteKind): ChartNote[] {
  if (kind.reach === 'shared') return sources.shared
  return kind.scope === 'setlist' ? sources.setlistPrivate : sources.songPrivate
}

/** Every note, with the kind it is kept as (one id shows once: the first place that has it) */
export function allNotes(sources: NoteSources): { note: ChartNote; kind: NoteKind }[] {
  const seen = new Set<string>()
  const out: { note: ChartNote; kind: NoteKind }[] = []
  const kinds: [ChartNote[], NoteKind][] = [
    [sources.shared, { scope: 'setlist', reach: 'shared' }],
    [sources.setlistPrivate, { scope: 'setlist', reach: 'private' }],
    [sources.songPrivate, { scope: 'song', reach: 'private' }],
  ]
  for (const [notes, kind] of kinds) {
    for (const note of notes) {
      if (seen.has(note.id)) continue
      seen.add(note.id)
      out.push({ note, kind })
    }
  }
  return out
}

/** The sources without this note */
export function removeNote(sources: NoteSources, id: string): NoteSources {
  const keep = <T extends ChartNote>(notes: T[]) => (notes.some(n => n.id === id) ? notes.filter(n => n.id !== id) : notes)
  return {
    shared: keep(sources.shared),
    setlistPrivate: keep(sources.setlistPrivate),
    songPrivate: keep(sources.songPrivate),
  }
}

/**
 * The sources with this note kept as `kind`: added, or changed, or moved from where it was (its id
 * is kept). Throws for a kind that cannot be: a shared note that is not text, or shared for ever.
 */
export function putNote(sources: NoteSources, note: ChartNote, kind: NoteKind): NoteSources {
  if (kind.reach === 'shared' && (kind.scope !== 'setlist' || note.body.kind !== 'text')) {
    throw new Error('A note can be shared only as text on this setlist')
  }
  const without = removeNote(sources, note.id)
  const put = { ...note, modified: new Date().toISOString() }
  if (kind.reach === 'shared') return { ...without, shared: [...without.shared, put as SharedChartNote] }
  const field = kind.scope === 'setlist' ? 'setlistPrivate' : 'songPrivate'
  return { ...without, [field]: [...listFor(without, kind), put] }
}

/** Which places differ between two states of the sources, so only those are written */
export function changedSources(before: NoteSources, after: NoteSources): (keyof NoteSources)[] {
  return (Object.keys(before) as (keyof NoteSources)[]).filter(
    field => before[field] !== after[field]
  )
}

/** A setlist entry with these shared notes (none: the field is left off, as it is for a setlist that never had any) */
export function withAnnotations(entry: SetlistEntry, notes: SharedChartNote[]): void {
  if (notes.length) entry.annotations = notes
  else delete entry.annotations
}
