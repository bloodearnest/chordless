/**
 * Notes that arrive from outside (a share link): kept only if they are what a shared note is, text
 * with an anchor this version knows. A bad one is left out, not a reason to refuse the whole
 * share; a drawing never arrives this way (docs/NOTES.md).
 */
import type { NoteAnchor, SharedChartNote } from '../data-types.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isLabel = (value: unknown): value is string | null => value === null || typeof value === 'string'
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0

function readAnchor(value: unknown): NoteAnchor | null {
  if (!isRecord(value)) return null
  if (value.kind === 'song') return { kind: 'song' }
  if (!isLabel(value.label) || !isCount(value.nth)) return null
  if (value.kind === 'section') return { kind: 'section', label: value.label, nth: value.nth }
  if (
    value.kind === 'text' &&
    isCount(value.line) &&
    isCount(value.offset) &&
    typeof value.before === 'string' &&
    typeof value.after === 'string'
  ) {
    return {
      kind: 'text',
      label: value.label,
      nth: value.nth,
      line: value.line,
      offset: value.offset,
      before: value.before,
      after: value.after,
    }
  }
  return null
}

/** The shared notes in `value`, if it is a list of them; those that are not well formed are left out */
export function readSharedNotes(value: unknown): SharedChartNote[] {
  if (!Array.isArray(value)) return []
  const notes: SharedChartNote[] = []
  for (const each of value) {
    if (!isRecord(each) || typeof each.id !== 'string' || !each.id) continue
    const anchor = readAnchor(each.anchor)
    const body = each.body
    if (!anchor || !isRecord(body) || body.kind !== 'text' || typeof body.text !== 'string') continue
    notes.push({
      id: each.id,
      anchor,
      body: { kind: 'text', text: body.text },
      ...(typeof each.createdBy === 'string' && { createdBy: each.createdBy }),
      modified: typeof each.modified === 'string' ? each.modified : '',
    })
  }
  return notes
}
