/**
 * Putting a space back to what an export holds ("Reset from import", docs/SPACES.md, "Export and
 * import"): a restore from a backup, or the way to take a library repaired off to the side.
 *
 * An import only adds, so a changed chart in a file could never replace the one here. A reset
 * does, matching by identity (a chart's uuid, a setlist's id), and changes only what differs:
 *
 * - **In both, and different:** the file's content replaces the content here. The record keeps
 *   its uuid (so the capo and sections kept on this device for the song stay with it) and its link
 *   to its file in Drive, which makes the change an ordinary local edit: the next sync sends it as
 *   an update of the same file, not as a second one.
 * - **Only in the file:** added, with the uuid it has there, so the setlists that name it find it.
 * - **Only here:** kept, and counted. A deletion of a file in Drive is a decision this does not
 *   take; the plan says how many there are.
 *
 * What it replaces is first counted (`planReset`), with the records that are newer here than in
 * the file, so the user is told what a reset undoes before it is done.
 */

import type { Setlist, SongRecord } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import type { SpaceExport } from './space-export.ts'
import { setlistContent, setlistContentHash } from './sync/setlist-hash.ts'

/** The fields of a chart's record that an export keeps, and a reset compares and replaces */
const SONG_CONTENT_FIELDS = [
  'id',
  'variantOf',
  'isDefault',
  'variantLabel',
  'ccliNumber',
  'title',
  'titleNormalized',
  'author',
  'copyright',
  'key',
  'originalKey',
  'tempo',
  'originalTempo',
  'time',
  'importDate',
  'importUser',
  'importSource',
  'sourceUrl',
] as const

/** What a setlist keeps of this device's through a reset: its link to its file in Drive, and its share link */
const SETLIST_KEPT_FIELDS = [
  'fileRef',
  'fileModified',
  'fileRev',
  'lastSyncedAt',
  'syncedContentHash',
  '_lastSyncHash',
  'share',
] as const

/** A song or setlist a reset would touch */
export interface ResetItem {
  /** A song's uuid, or a setlist's id */
  id: string
  label: string
  /** Whether the copy here was changed after the file's was: a reset undoes that */
  newerHere: boolean
}

export interface ResetPlan {
  songsReplaced: ResetItem[]
  songsAdded: ResetItem[]
  songsSame: number
  /** Here and not in the file: kept */
  songsOnlyHere: number
  setlistsReplaced: ResetItem[]
  setlistsAdded: ResetItem[]
  setlistsSame: number
  setlistsOnlyHere: number
}

/** What a reset did */
export type ResetReport = Pick<
  ResetPlan,
  'songsSame' | 'songsOnlyHere' | 'setlistsSame' | 'setlistsOnlyHere'
> & {
  songsReplaced: number
  songsAdded: number
  setlistsReplaced: number
  setlistsAdded: number
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Whether a song differs from the file's: its chart's text, or what the record says of it */
function songDiffers(
  here: SongRecord,
  there: SongRecord,
  hereText: string | undefined,
  thereText: string | undefined
): boolean {
  if (hereText !== thereText) return true
  return SONG_CONTENT_FIELDS.some(field => !same(here[field], there[field]))
}

/** A setlist as an export holds it: no sync state, and no share link (that is this device's) */
function exportedForm(setlist: Setlist): Setlist {
  const { share: _share, ...content } = setlistContent(setlist)
  return content as Setlist
}

const setlistLabel = (setlist: Setlist) =>
  [setlist.date, setlist.name || setlist.type].filter(Boolean).join(' ')

const newer = (here: string | undefined, there: string | undefined) =>
  Boolean(here && there && here > there)

/** What a reset to this export would do to the space. Changes nothing. */
export async function planReset(exported: SpaceExport, db: ChordlessDB): Promise<ResetPlan> {
  const plan: ResetPlan = {
    songsReplaced: [],
    songsAdded: [],
    songsSame: 0,
    songsOnlyHere: 0,
    setlistsReplaced: [],
    setlistsAdded: [],
    setlistsSame: 0,
    setlistsOnlyHere: 0,
  }

  const songsHere = new Map((await db.getAllSongs()).map(song => [song.uuid, song]))
  for (const there of exported.songs) {
    const here = songsHere.get(there.uuid)
    const item = { id: there.uuid, label: there.title, newerHere: false }
    if (!here) plan.songsAdded.push(item)
    else if (
      songDiffers(
        here,
        there,
        (await db.getChordPro(here.chordproFileId))?.content,
        exported.chordpro.get(there.chordproFileId)
      )
    ) {
      plan.songsReplaced.push({
        ...item,
        newerHere: newer(here.modifiedDate, there.modifiedDate),
      })
    } else plan.songsSame++
  }
  const songsThere = new Set(exported.songs.map(song => song.uuid))
  plan.songsOnlyHere = [...songsHere.keys()].filter(uuid => !songsThere.has(uuid)).length

  // (a received share is someone else's and kept apart, as in an export; a setlist that was
  // deleted here counts as absent, so the file brings it back)
  const setlistsHere = new Map(
    (await db.getAllSetlists())
      .filter(setlist => !setlist.received && !setlist.deletedAt)
      .map(setlist => [setlist.id, setlist])
  )
  for (const there of exported.setlists) {
    const here = setlistsHere.get(there.id)
    const item = { id: there.id, label: setlistLabel(there), newerHere: false }
    if (!here) plan.setlistsAdded.push(item)
    else if (setlistContentHash(exportedForm(here)) !== setlistContentHash(there)) {
      plan.setlistsReplaced.push({
        ...item,
        newerHere: newer(here.modifiedDate, there.modifiedDate),
      })
    } else plan.setlistsSame++
  }
  const setlistsThere = new Set(exported.setlists.map(setlist => setlist.id))
  plan.setlistsOnlyHere = [...setlistsHere.keys()].filter(id => !setlistsThere.has(id)).length
  return plan
}

/**
 * Put the space's charts and setlists back to what the export holds (see the top of this file),
 * changing only what differs. Everything it writes is stamped as changed now, so sync sends it.
 */
export async function resetToExport(exported: SpaceExport, db: ChordlessDB): Promise<ResetReport> {
  const plan = await planReset(exported, db)
  const now = new Date().toISOString()

  const replacing = new Set(plan.songsReplaced.map(item => item.id))
  const adding = new Set(plan.songsAdded.map(item => item.id))
  for (const there of exported.songs) {
    if (!replacing.has(there.uuid) && !adding.has(there.uuid)) continue
    const here = await db.getSong(there.uuid)
    const content = exported.chordpro.get(there.chordproFileId)
    if (content === undefined) continue
    // (the chart keeps the id it has here; a new song gets one of its own: the file's is a path)
    const chordproFileId = here?.chordproFileId ?? `chordpro-${crypto.randomUUID()}`
    const chart = here ? await db.getChordPro(chordproFileId) : undefined
    await db.saveChordPro({
      id: chordproFileId,
      content,
      contentHash: there.contentHash,
      createdDate: chart?.createdDate ?? now,
      modifiedDate: now,
    })
    // (saveSong keeps the link to the song's file in Drive, since this copy has none: the
    // difference from what was last synced is what makes sync send it)
    await db.saveSong({
      ...there,
      chordproFileId,
      fileRef: null,
      fileModified: null,
      lastSyncedAt: null,
      modifiedDate: now,
      metadataChangedAt: now,
    })
  }

  const replacingSetlists = new Set(plan.setlistsReplaced.map(item => item.id))
  const addingSetlists = new Set(plan.setlistsAdded.map(item => item.id))
  for (const there of exported.setlists) {
    if (replacingSetlists.has(there.id)) {
      await db.updateSetlist(there.id, draft => {
        // (what is this device's: its link to the file in Drive, and its share link)
        const record = draft as unknown as Record<string, unknown>
        const kept = Object.fromEntries(
          SETLIST_KEPT_FIELDS.filter(field => record[field] !== undefined).map(field => [
            field,
            record[field],
          ])
        )
        for (const key of Object.keys(record)) delete record[key]
        Object.assign(record, structuredClone(there), kept, { modifiedDate: now })
      })
    } else if (addingSetlists.has(there.id)) {
      await db.saveSetlist({ ...structuredClone(there), modifiedDate: now })
    }
  }

  return {
    songsReplaced: plan.songsReplaced.length,
    songsAdded: plan.songsAdded.length,
    songsSame: plan.songsSame,
    songsOnlyHere: plan.songsOnlyHere,
    setlistsReplaced: plan.setlistsReplaced.length,
    setlistsAdded: plan.setlistsAdded.length,
    setlistsSame: plan.setlistsSame,
    setlistsOnlyHere: plan.setlistsOnlyHere,
  }
}
