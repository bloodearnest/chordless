/** Reapply the fields actually edited here to the current server record. */

import { type SpaceRecord, sameContent } from './space-data-records.ts'
import type { SpaceRecordKind, SpaceSetlistSong } from './space-data-types.ts'

type Fields = Record<string, unknown>

function fields(
  base: Fields,
  local: Fields,
  remote: Fields
): { record: Fields; conflict: boolean } {
  const record = { ...remote }
  let conflict = false
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (key === 'version' || key === 'modifiedAt') continue
    if (sameContent(base[key], local[key])) continue
    if (!sameContent(base[key], remote[key]) && !sameContent(local[key], remote[key]))
      conflict = true
    if (local[key] === undefined) delete record[key]
    else record[key] = local[key]
  }
  return { record, conflict }
}

/** Entry identity is the song id; a variant change edits that entry rather than adding a second song. */
function entries(base: SpaceSetlistSong[], local: SpaceSetlistSong[], remote: SpaceSetlistSong[]) {
  const before = new Map(base.map(entry => [entry.songId, entry]))
  const mine = new Map(local.map(entry => [entry.songId, entry]))
  const theirs = new Map(remote.map(entry => [entry.songId, entry]))
  let conflict = false
  const kept = new Map(theirs)
  for (const [id, old] of before) {
    const wanted = mine.get(id)
    const current = theirs.get(id)
    if (!wanted) {
      if (current && !sameContent(old, current)) conflict = true
      kept.delete(id)
    } else if (current) {
      const merged = fields(
        old as unknown as Fields,
        wanted as unknown as Fields,
        current as unknown as Fields
      )
      conflict ||= merged.conflict
      kept.set(id, merged.record as unknown as SpaceSetlistSong)
    } else if (!sameContent(old, wanted)) {
      // Both changed this entry: the later local edit keeps it.
      kept.set(id, wanted)
      conflict = true
    }
  }
  for (const [id, entry] of mine) {
    if (!before.has(id)) {
      if (theirs.has(id) && !sameContent(theirs.get(id), entry)) conflict = true
      kept.set(id, entry)
    }
  }
  const oldOrder = base
    .filter(entry => mine.has(entry.songId) && kept.has(entry.songId))
    .map(entry => entry.songId)
  const newOrder = local
    .filter(entry => before.has(entry.songId) && kept.has(entry.songId))
    .map(entry => entry.songId)
  // Preserve concurrent server ordering unless this person moved existing entries.
  const moved = !sameContent(oldOrder, newOrder)
  let order = remote.map(entry => entry.songId).filter(id => kept.has(id))
  if (moved) {
    const shared = new Set(newOrder)
    let next = 0
    order = order.map(id => (shared.has(id) ? newOrder[next++] : id))
    order.push(...newOrder.slice(next))
    const serverOrder = remote
      .filter(entry => before.has(entry.songId) && mine.has(entry.songId))
      .map(entry => entry.songId)
    conflict ||= !sameContent(serverOrder, oldOrder) && !sameContent(serverOrder, newOrder)
  }
  // Insert new or locally restored entries after their nearest surviving predecessor.
  for (let i = 0; i < local.length; i++) {
    const id = local[i].songId
    if (!kept.has(id) || order.includes(id)) continue
    let at = -1
    for (let j = i - 1; j >= 0 && at < 0; j--) at = order.indexOf(local[j].songId)
    order.splice(at + 1, 0, id)
  }
  return { songs: order.map(id => kept.get(id) as SpaceSetlistSong), conflict }
}

export function mergeSpaceRecord(
  kind: SpaceRecordKind,
  base: SpaceRecord | null,
  local: SpaceRecord,
  remote: SpaceRecord
) {
  const old = (base ?? {}) as unknown as Fields
  const mine = { ...local } as unknown as Fields
  const current = remote as unknown as Fields
  if (kind !== 'setlist') {
    const result = fields(old, mine, current)
    return { record: result.record as unknown as SpaceRecord, conflict: result.conflict }
  }
  const mergedEntries = entries(
    (old.songs ?? []) as SpaceSetlistSong[],
    mine.songs as SpaceSetlistSong[],
    current.songs as SpaceSetlistSong[]
  )
  delete mine.songs
  delete mine.body
  const result = fields({ ...old, songs: undefined, body: undefined }, mine, {
    ...current,
    songs: undefined,
    body: undefined,
  })
  // The body's metadata also merges by field, not as one opaque object.
  const body = fields(
    (old.body ?? {}) as Fields,
    (local as unknown as Fields).body as Fields,
    current.body as Fields
  )
  return {
    record: {
      ...result.record,
      body: body.record,
      songs: mergedEntries.songs,
    } as unknown as SpaceRecord,
    conflict: result.conflict || body.conflict || mergedEntries.conflict,
  }
}
