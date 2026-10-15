/**
 * What a setlist keeps on this device, in localStorage, and not in the setlist (so not in Drive):
 * how each part of each song is shown (the user's own choices in this setlist), and each song's
 * capo. Both are per song, by its place in the setlist.
 */
import type { SectionState } from '../data-types.ts'

/** Per song index, then per section index */
export type SectionStates = Record<number, Record<number, SectionState>>

export interface SetlistLocalState {
  sectionState: SectionStates
  /** Per song index */
  capoValues: Record<string, unknown>
}

const keyFor = (setlistId: string | null) => `state-${setlistId}`

/**
 * What was kept, with nothing where it can't be read. Older versions kept the section states
 * at the top level, and the capos as `capo`.
 */
export function loadSetlistLocalState(setlistId: string | null): SetlistLocalState {
  let saved: Record<string, unknown> = {}
  try {
    saved = JSON.parse(localStorage.getItem(keyFor(setlistId)) ?? 'null') ?? {}
  } catch (error) {
    console.error('Failed to parse saved state:', error)
  }
  return {
    sectionState: (saved.sectionState ??
      Object.fromEntries(
        Object.entries(saved).filter(([key]) => /^\d+$/.test(key))
      )) as SectionStates,
    capoValues: (saved.capoValues ?? saved.capo ?? {}) as Record<string, unknown>,
  }
}

export function saveSetlistLocalState(setlistId: string | null, state: SetlistLocalState) {
  try {
    localStorage.setItem(keyFor(setlistId), JSON.stringify(state))
  } catch (error) {
    console.error('Failed to save the setlist state:', error)
  }
}

/** Forget it all: the setlist has been deleted */
export function clearSetlistLocalState(setlistId: string) {
  localStorage.removeItem(keyFor(setlistId))
}
