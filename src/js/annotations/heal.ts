/**
 * Keeping the anchors of a song's annotations up to date as its chart is edited (docs/ANNOTATIONS.md):
 * those found somewhere other than where they are stored, or stored without a snapshot, get an anchor
 * rebuilt from the chart as it is. Pure: the page decides which kind to heal and when, and saves.
 */
import type { ChartSection } from '../data-types.ts'
import { placeAnnotations } from './anchor.ts'
import type { AnnotationSources } from './store.ts'

/** The sources with the anchors of `which` rebuilt where they differ, or null if none does (the arrays are then the same ones) */
export function healSources(
  sections: ChartSection[],
  sources: AnnotationSources,
  which: (keyof AnnotationSources)[]
): AnnotationSources | null {
  let healed: AnnotationSources | null = null
  for (const field of which) {
    const placed = placeAnnotations(sections, sources[field])
    if (!placed.some(each => each.healed)) continue
    const rebuilt = placed.map(({ annotation, healed: anchor }) =>
      anchor ? { ...annotation, anchor } : annotation
    )
    healed = { ...(healed ?? sources), [field]: rebuilt } as AnnotationSources
  }
  return healed
}
