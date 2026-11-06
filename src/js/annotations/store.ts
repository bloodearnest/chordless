/**
 * The annotations on one song of a setlist as they are kept (docs/ANNOTATIONS.md): two places, by
 * who sees them. Pure functions over those, so a page loads and saves each as it does its other
 * state and this decides what goes where. An annotation belongs to one song in one setlist.
 *
 *   shared   the setlist's entry for the song (`annotations`; synced): everyone who has the setlist
 *   private  this device, in the setlist's local state: just the user
 */
import type { ChartAnnotation, SetlistEntry, SharedChartAnnotation } from '../data-types.ts'
import { atLeast, type TeamRole } from '../team-roles.ts'

/** Who sees an annotation: just the user, or everyone who has the setlist */
export type AnnotationKind = 'private' | 'shared'

/** The default for a new annotation: just the user (never shared by surprise) */
export const DEFAULT_ANNOTATION_KIND: AnnotationKind = 'private'

export interface AnnotationSources {
  shared: SharedChartAnnotation[]
  private: ChartAnnotation[]
}

export const noSources = (): AnnotationSources => ({ shared: [], private: [] })

/** Whether an annotation can be shared with everyone: the user can write the setlist, which is not a received share */
export function canShareAnnotations(
  space: { readOnly?: boolean; team?: { role: TeamRole } } | undefined,
  setlist: { received?: unknown } | undefined
): boolean {
  if (setlist?.received) return false
  if (space?.readOnly) return false
  return space?.team ? atLeast(space.team.role, 'writer') : true
}

/** Whether an annotation can be of this kind (and so be moved to it): only text can be shared, and only by one who may */
export function kindAllowed(
  kind: AnnotationKind,
  annotation: ChartAnnotation,
  mayShare: boolean
): boolean {
  return kind === 'private' || (mayShare && annotation.body.kind === 'text')
}

/** Every annotation, with the kind it is kept as (one id shows once: the shared one if there are two) */
export function allAnnotations(
  sources: AnnotationSources
): { annotation: ChartAnnotation; kind: AnnotationKind }[] {
  const seen = new Set<string>()
  const out: { annotation: ChartAnnotation; kind: AnnotationKind }[] = []
  const kinds: [ChartAnnotation[], AnnotationKind][] = [
    [sources.shared, 'shared'],
    [sources.private, 'private'],
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
    annotations.some(each => each.id === id)
      ? annotations.filter(each => each.id !== id)
      : annotations
  return { shared: keep(sources.shared), private: keep(sources.private) }
}

/**
 * The sources with this annotation kept as `kind`: added, or changed, or moved from where it was (its
 * id is kept). Throws for a kind that cannot be: a shared annotation that is not text.
 */
export function putAnnotation(
  sources: AnnotationSources,
  annotation: ChartAnnotation,
  kind: AnnotationKind
): AnnotationSources {
  if (kind === 'shared' && annotation.body.kind !== 'text') {
    throw new Error('Only text can be shared with everyone')
  }
  const without = removeAnnotation(sources, annotation.id)
  const put = { ...annotation, modified: new Date().toISOString() }
  return kind === 'shared'
    ? { ...without, shared: [...without.shared, put as SharedChartAnnotation] }
    : { ...without, private: [...without.private, put] }
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
