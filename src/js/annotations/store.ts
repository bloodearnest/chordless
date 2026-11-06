/**
 * The annotations on one song as they are kept (docs/ANNOTATIONS.md): three places, by where a annotation shows and
 * who sees it. Pure functions over those three, so a page loads and saves each as it does its
 * other state and this decides what goes where.
 *
 *   setlist + shared  the setlist's entry for the song (`annotations`; synced)
 *   setlist + private this device, in the setlist's local state
 *   song + private    this device, in the space's database, for the song in any setlist
 *
 * Song + shared would need a synced collection and is not built.
 */
import type { ChartAnnotation, SetlistEntry, SharedChartAnnotation } from '../data-types.ts'
import { atLeast, type TeamRole } from '../team-roles.ts'

export type AnnotationScope = 'setlist' | 'song'
export type AnnotationReach = 'private' | 'shared'

export interface AnnotationKind {
  scope: AnnotationScope
  reach: AnnotationReach
}

/** The default for a new annotation: this setlist, just me (never shared by surprise) */
export const DEFAULT_ANNOTATION_KIND: AnnotationKind = { scope: 'setlist', reach: 'private' }

export interface AnnotationSources {
  shared: SharedChartAnnotation[]
  setlistPrivate: ChartAnnotation[]
  songPrivate: ChartAnnotation[]
}

export const noSources = (): AnnotationSources => ({
  shared: [],
  setlistPrivate: [],
  songPrivate: [],
})

/** Whether a annotation can be shared with the team: the user can write the setlist, which is not a received share */
export function canShareAnnotations(
  space: { readOnly?: boolean; team?: { role: TeamRole } } | undefined,
  setlist: { received?: unknown } | undefined
): boolean {
  if (setlist?.received) return false
  if (space?.readOnly) return false
  return space?.team ? atLeast(space.team.role, 'writer') : true
}

/** Whether a annotation of this kind can be made at all (and so a annotation can be moved to it) */
export function kindAllowed(
  kind: AnnotationKind,
  annotation: ChartAnnotation,
  mayShare: boolean
): boolean {
  if (kind.reach === 'shared')
    return mayShare && kind.scope === 'setlist' && annotation.body.kind === 'text'
  return true
}

/** Every annotation, with the kind it is kept as (one id shows once: the first place that has it) */
export function allAnnotations(
  sources: AnnotationSources
): { annotation: ChartAnnotation; kind: AnnotationKind }[] {
  const seen = new Set<string>()
  const out: { annotation: ChartAnnotation; kind: AnnotationKind }[] = []
  const kinds: [ChartAnnotation[], AnnotationKind][] = [
    [sources.shared, { scope: 'setlist', reach: 'shared' }],
    [sources.setlistPrivate, { scope: 'setlist', reach: 'private' }],
    [sources.songPrivate, { scope: 'song', reach: 'private' }],
  ]
  for (const [annotations, kind] of kinds) {
    for (const annotation of annotations) {
      if (seen.has(annotation.id)) continue
      seen.add(annotation.id)
      out.push({ annotation, kind })
    }
  }
  return out
}

/** The sources without this annotation */
export function removeAnnotation(sources: AnnotationSources, id: string): AnnotationSources {
  const keep = <T extends ChartAnnotation>(annotations: T[]) =>
    annotations.some(n => n.id === id) ? annotations.filter(n => n.id !== id) : annotations
  return {
    shared: keep(sources.shared),
    setlistPrivate: keep(sources.setlistPrivate),
    songPrivate: keep(sources.songPrivate),
  }
}

/**
 * The sources with this annotation kept as `kind`: added, or changed, or moved from where it was (its id
 * is kept). Throws for a kind that cannot be: a shared annotation that is not text, or shared for ever.
 */
export function putAnnotation(
  sources: AnnotationSources,
  annotation: ChartAnnotation,
  kind: AnnotationKind
): AnnotationSources {
  if (kind.reach === 'shared' && (kind.scope !== 'setlist' || annotation.body.kind !== 'text')) {
    throw new Error('A annotation can be shared only as text on this setlist')
  }
  const without = removeAnnotation(sources, annotation.id)
  const put = { ...annotation, modified: new Date().toISOString() }
  if (kind.reach === 'shared')
    return { ...without, shared: [...without.shared, put as SharedChartAnnotation] }
  const field = kind.scope === 'setlist' ? 'setlistPrivate' : 'songPrivate'
  return { ...without, [field]: [...without[field], put] }
}

/** Which places differ between two states of the sources, so only those are written */
export function changedSources(
  before: AnnotationSources,
  after: AnnotationSources
): (keyof AnnotationSources)[] {
  return (Object.keys(before) as (keyof AnnotationSources)[]).filter(
    field => before[field] !== after[field]
  )
}

/** A setlist entry with these shared annotations (none: the field is left off, as it is for a setlist that never had any) */
export function withAnnotations(entry: SetlistEntry, annotations: SharedChartAnnotation[]): void {
  if (annotations.length) entry.annotations = annotations
  else delete entry.annotations
}
