/**
 * When both sides changed a setlist (docs/SYNC_ARCHITECTURE.md, "When both sides changed a
 * setlist"): the leader's version is the base, and the other version adds to it. The base keeps its
 * order, keys, tempos and details; what the other side adds, its new songs and its annotations,
 * is kept, so the one thing nobody wants to lose, a note on a chart, never is. Pure.
 */
import type {
  Person,
  Setlist,
  SetlistEntry,
  SharedChartAnnotation,
  SyncedShape,
} from '../data-types.ts'
import { normalizeEmail, resolvePerson } from '../leaders.ts'
import { hashText } from '../utils/hash.ts'

/** The entry's name in a setlist: the song, and which of that song it is when it is in twice */
function entryKeys(setlist: Pick<Setlist, 'songs'>): string[] {
  const seen = new Map<string, number>()
  return setlist.songs.map(entry => {
    const count = seen.get(entry.songId) ?? 0
    seen.set(entry.songId, count + 1)
    return `${entry.songId}#${count}`
  })
}

const textOf = (annotation: SharedChartAnnotation) => hashText(annotation.body.text)

/** What a setlist holds, as a later merge needs to know it */
export function shapeOf(setlist: Pick<Setlist, 'songs'>): SyncedShape {
  const annotations: Record<string, string> = {}
  for (const entry of setlist.songs) {
    for (const annotation of entry.annotations ?? [])
      annotations[annotation.id] = textOf(annotation)
  }
  return { songs: entryKeys(setlist), annotations }
}

/** Who is using this device, as far as a setlist's leader can be told from the people */
export interface Me {
  /** The signed-in account's address, if signed in */
  email: string | null
  /** The person this device was told is the one using it, if it was told */
  chosenPersonId: string | null
}

/**
 * Whether the person using this device leads a setlist, by the copy in Drive (so that changing
 * the leader on this device cannot make it win): the leader's addresses include the signed-in
 * account's, or the leader is the person this device was told is its user.
 */
export function leadsIt(shared: Pick<Setlist, 'leaderId'>, people: Person[], me: Me): boolean {
  const leader = resolvePerson(people, shared.leaderId)
  if (!leader) return false
  if (me.chosenPersonId && resolvePerson(people, me.chosenPersonId)?.id === leader.id) return true
  const email = me.email ? normalizeEmail(me.email) : ''
  return Boolean(email) && leader.emails.some(each => normalizeEmail(each) === email)
}

/** What a merge did: for the message, and for a test */
export interface MergeResult {
  merged: Setlist
  /** The songs taken from the other side */
  songsAdded: string[]
  /** Annotations taken from the other side (a changed one counts, and a clash is kept as a second) */
  annotationsAdded: number
}

/**
 * The setlist to keep when both sides changed it. `winner` is the leader's version; `other` is the
 * other's. `base` says what the setlist held when last synced, to tell what each side added from
 * what the other removed; with none (a record synced before it was kept), what the other side has
 * that the winner lacks is taken as added.
 */
export function mergeSetlists(
  winner: Setlist,
  other: Setlist,
  base: SyncedShape | null | undefined
): MergeResult {
  const winnerKeys = entryKeys(winner)
  const otherKeys = entryKeys(other)
  const baseSongs = new Set(base?.songs ?? [])
  const has = new Set(winnerKeys)

  // Songs the other side added (in the base, a song the winner lacks was removed by the winner)
  const entries: { key: string; entry: SetlistEntry }[] = winner.songs.map((entry, index) => ({
    key: winnerKeys[index],
    entry,
  }))
  const songsAdded: string[] = []
  other.songs.forEach((entry, index) => {
    const key = otherKeys[index]
    if (has.has(key) || baseSongs.has(key)) return
    // (first if it was first there, else after the song it followed if the winner has it, else last)
    const at = index > 0 ? entries.findIndex(each => each.key === otherKeys[index - 1]) : -2
    const added = { key, entry }
    if (at === -2) entries.unshift(added)
    else if (at >= 0) entries.splice(at + 1, 0, added)
    else entries.push(added)
    has.add(key)
    songsAdded.push(entry.songId)
  })

  // Annotations: the other side's new ones, and its edits to ones the winner did not edit
  const otherByKey = new Map(other.songs.map((entry, index) => [otherKeys[index], entry]))
  let annotationsAdded = 0
  const merged = entries.map(({ key, entry }) => {
    const theirs = otherByKey.get(key)
    if (!theirs?.annotations?.length) return entry
    const mine = [...(entry.annotations ?? [])]
    const mineById = new Map(mine.map((annotation, index) => [annotation.id, index]))
    for (const annotation of theirs.annotations) {
      const at = mineById.get(annotation.id)
      const was = base?.annotations[annotation.id]
      if (at === undefined) {
        // Not in the winner's: the other side added it, unless the winner removed it
        if (was !== undefined) continue
        mine.push(annotation)
        annotationsAdded++
        continue
      }
      const kept = mine[at]
      const theirHash = textOf(annotation)
      if (theirHash === textOf(kept) || theirHash === was) continue // the same, or not edited there
      if (textOf(kept) === was) {
        // The winner did not edit it: the other side's edit applies
        mine[at] = { ...kept, body: annotation.body, modified: annotation.modified }
      } else {
        // Both edited it: the winner's stays and the other's text is kept beside it, as a second
        // annotation in the same place (its id is made from the text, so every device makes the
        // same one)
        const id = `${annotation.id}~${theirHash}`
        if (mineById.has(id)) continue
        mine.push({ ...annotation, id })
      }
      annotationsAdded++
    }
    return mine.length === (entry.annotations?.length ?? 0) &&
      mine.every((a, i) => a === entry.annotations?.[i])
      ? entry
      : { ...entry, annotations: mine }
  })

  return {
    merged: {
      ...winner,
      songs: merged.map((entry, order) => ({ ...entry, order })),
    },
    songsAdded,
    annotationsAdded,
  }
}
