/**
 * Starting a branch preview with songs in it (docs/PREVIEWS.md): the dev server may hand the page an
 * export (vite-plugins/preview-seed.ts), and an empty Personal space imports it. Run from the app's
 * start-up in dev only (`import.meta.env.DEV`), so a build carries none of it.
 *
 * Only an empty space is seeded, so what a tester then adds, changes or deletes is left alone; clearing
 * the site's data brings the seed back.
 */
import { type ChordlessDB, openSpace } from './db.ts'
import { ensureCurrentSpace, ensurePersonalSpace, listSpaces } from './space.ts'
import { importIntoSpace, readExport } from './space-export.ts'

export const SEED_URL = '/__preview-seed.zip'

/** The songs and setlists added, or null where there was no seed to use or the space already had songs */
export async function seedFromPreview(
  fetchSeed: () => Promise<Response> = () =>
    fetch(SEED_URL, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
): Promise<{ songs: number; setlists: number } | null> {
  const response = await fetchSeed().catch(() => null)
  // (a server with no seed may answer any path with its start page: only a zip counts)
  if (!response?.ok || !response.headers.get('content-type')?.includes('zip')) return null
  const exported = await readExport(await response.blob())

  const id = await personalSpaceId()
  const db = await openSpace(id)
  try {
    return await seedIfEmpty(db, exported)
  } finally {
    db.db?.close()
  }
}

/** Import into a space that has no songs */
export async function seedIfEmpty(
  db: ChordlessDB,
  exported: Awaited<ReturnType<typeof readExport>>
): Promise<{ songs: number; setlists: number } | null> {
  if ((await db.getAllSongs()).length > 0) return null
  const report = await importIntoSpace(exported, db)
  return { songs: report.songsAdded, setlists: report.setlistsAdded }
}

/** The device's Personal space (the first without a team), made if it has none */
async function personalSpaceId(): Promise<string> {
  let spaces = await listSpaces()
  if (spaces.length === 0) {
    await ensureCurrentSpace()
  } else {
    await ensurePersonalSpace(spaces)
  }
  spaces = await listSpaces()
  const personal = spaces.find(space => !space.team)
  if (!personal) throw new Error('There is no Personal space to seed')
  return personal.id
}
