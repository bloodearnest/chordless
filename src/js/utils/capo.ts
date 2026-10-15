/** A capo as a whole fret from 0 to 11; anything that isn't a number is no capo */
export function normalizeCapo(value: unknown): number {
  const fret = Number(value)
  if (!Number.isFinite(fret) || fret <= 0) return 0
  return Math.min(Math.round(fret), 11)
}
