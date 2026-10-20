/**
 * Exporting a space to a zip file, and importing one (docs/SPACES.md, "Export and import").
 * The zip holds what the user would want back: every chart as a `.cho` file, the setlists as JSON,
 * and (only if asked, as they are large) the pad sets. Nothing of Drive is in it (no file ids, no
 * share links), so it can be imported into any space, on any account.
 *
 *   manifest.json                what and when, and how much
 *   songs.json                   each chart's record (its identity, variant, key, tempo)
 *   songs/<title>-<id>.cho       each chart's text
 *   setlists/<date>-<name>-<id>.json
 *   pads/<set>/<KEY>.mp3
 *
 * An import adds what the space lacks and skips what it has (charts by content, setlists by id),
 * so running it twice adds nothing; it deletes nothing.
 */
import type { Setlist, SongRecord } from './data-types.ts'
import type { ChordlessDB } from './db.ts'
import { PAD_FILE_KEYS } from './pad-keys.ts'
import { type PadSet, readPadSetAudio, uploadPadSet } from './pad-set-service.ts'
import { type TransferReport, type TransferSource, transferSpace } from './space-transfer.ts'
import { setlistContent } from './sync/setlist-hash.ts'
import { hashText } from './utils/hash.ts'
import { readZip, writeZip, type ZipFile } from './utils/zip.ts'

export const EXPORT_FORMAT = 'chordless-export'
const EXPORT_VERSION = 1

/** What manifest.json says */
export interface ExportManifest {
  format: typeof EXPORT_FORMAT
  version: number
  /** ISO time the export was made */
  created: string
  /** The name of the space it was exported from */
  space: string
  counts: { songs: number; setlists: number; padSets: number }
  /** The pad sets in the file, by name (their files are under `pads/<dir>/`) */
  padSets: { name: string; dir: string }[]
}

/** The fields of a chart's record that an export keeps */
type ExportSong = Pick<
  SongRecord,
  | 'uuid'
  | 'id'
  | 'variantOf'
  | 'isDefault'
  | 'variantLabel'
  | 'ccliNumber'
  | 'title'
  | 'titleNormalized'
  | 'author'
  | 'copyright'
  | 'key'
  | 'originalKey'
  | 'tempo'
  | 'originalTempo'
  | 'time'
  | 'importDate'
  | 'importUser'
  | 'importSource'
  | 'sourceUrl'
  | 'modifiedDate'
> & { file: string }

/** An export file read into memory */
export interface SpaceExport {
  manifest: ExportManifest
  songs: SongRecord[]
  chordpro: Map<string, string>
  setlists: Setlist[]
  /** The pad sets' audio, read from the zip when asked (they are large) */
  padAudio(dir: string): Promise<Map<string, Uint8Array<ArrayBuffer>>>
}

/** A name that is safe in a file path, and short */
function slug(text: string): string {
  const cleaned = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return cleaned || 'untitled'
}

const shortId = (id: string) => id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)

/** A pad set to put in an export: its name and its audio by key */
export interface ExportPadSet {
  name: string
  audio: Map<string, ArrayBuffer | Uint8Array>
}

/** Read pad sets from Drive for an export (the user is signed in, and online) */
export async function readPadSetsForExport(padSets: PadSet[]): Promise<ExportPadSet[]> {
  const read: ExportPadSet[] = []
  for (const padSet of padSets)
    read.push({ name: padSet.name, audio: await readPadSetAudio(padSet) })
  return read
}

/**
 * Make the export zip of a space: all its charts and setlists, and the given pad sets (none by
 * default).
 */
export async function createExport(
  db: ChordlessDB,
  spaceName: string,
  padSets: ExportPadSet[] = [],
  now = new Date()
): Promise<Blob> {
  const files: ZipFile[] = []

  const songs: ExportSong[] = []
  for (const song of await db.getAllSongs()) {
    const chordpro = await db.getChordPro(song.chordproFileId)
    if (!chordpro) continue
    const file = `songs/${slug(song.title)}-${shortId(song.uuid)}.cho`
    files.push({ name: file, data: chordpro.content })
    songs.push({
      uuid: song.uuid,
      id: song.id,
      variantOf: song.variantOf,
      isDefault: song.isDefault,
      variantLabel: song.variantLabel,
      ccliNumber: song.ccliNumber,
      title: song.title,
      titleNormalized: song.titleNormalized,
      author: song.author,
      copyright: song.copyright,
      key: song.key,
      originalKey: song.originalKey,
      tempo: song.tempo,
      originalTempo: song.originalTempo,
      time: song.time,
      importDate: song.importDate,
      importUser: song.importUser,
      importSource: song.importSource,
      sourceUrl: song.sourceUrl,
      modifiedDate: song.modifiedDate,
      file,
    })
  }

  let setlistCount = 0
  for (const setlist of await db.getAllSetlists()) {
    // (a received share is someone else's, kept apart; a deleted setlist is gone)
    if (setlist.deletedAt || setlist.received) continue
    const { share: _share, ...content } = setlistContent(setlist)
    const name = `setlists/${setlist.date}-${slug(setlist.name || setlist.type)}-${shortId(setlist.id)}.json`
    files.push({ name, data: JSON.stringify(content, null, 2) })
    setlistCount++
  }

  const padEntries: ExportManifest['padSets'] = []
  for (const padSet of padSets) {
    const dir = `${slug(padSet.name)}-${padEntries.length + 1}`
    padEntries.push({ name: padSet.name, dir })
    for (const key of PAD_FILE_KEYS) {
      const audio = padSet.audio.get(key)
      if (!audio) continue
      files.push({
        name: `pads/${dir}/${key}.mp3`,
        data: new Uint8Array(audio),
        compress: false,
      })
    }
  }

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    created: now.toISOString(),
    space: spaceName,
    counts: { songs: songs.length, setlists: setlistCount, padSets: padEntries.length },
    padSets: padEntries,
  }
  return writeZip(
    [
      { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
      { name: 'songs.json', data: JSON.stringify(songs, null, 2) },
      ...files,
    ],
    now
  )
}

/** The file name to offer for an export */
export function exportFileName(spaceName: string, now = new Date()): string {
  return `chordless-export-${slug(spaceName)}-${now.toISOString().slice(0, 10)}.zip`
}

/** Read an export zip. Throws, with a reason, if it is not one this version can read. */
export async function readExport(file: Blob): Promise<SpaceExport> {
  let zip: Awaited<ReturnType<typeof readZip>>
  try {
    zip = await readZip(file)
  } catch {
    throw new Error('That file is not a Chordless export: it is not a ZIP file')
  }
  const byName = new Map(zip.entries.map(entry => [entry.fileName, entry]))
  const text = async (name: string) => {
    const entry = byName.get(name)
    if (!entry) throw new Error(`That file is not a Chordless export: ${name} is missing`)
    return new TextDecoder().decode(await zip.read(entry))
  }

  let manifest: ExportManifest
  try {
    manifest = JSON.parse(await text('manifest.json'))
  } catch (error) {
    if ((error as Error).message.includes('missing')) throw error
    throw new Error('That file is not a Chordless export: its manifest cannot be read')
  }
  if (manifest.format !== EXPORT_FORMAT) throw new Error('That file is not a Chordless export')
  if (manifest.version > EXPORT_VERSION) {
    throw new Error('That export was made by a newer Chordless: update the app to import it')
  }

  const chordpro = new Map<string, string>()
  const songs: SongRecord[] = []
  for (const song of JSON.parse(await text('songs.json')) as ExportSong[]) {
    const content = await text(song.file)
    chordpro.set(song.file, content)
    const { file: chordproFileId, ...record } = song
    songs.push({
      ...record,
      chordproFileId,
      fileRef: null,
      fileModified: null,
      lastSyncedAt: null,
      contentHash: hashText(content),
    })
  }

  const setlists: Setlist[] = []
  for (const entry of zip.entries) {
    if (entry.fileName.startsWith('setlists/') && entry.fileName.endsWith('.json')) {
      setlists.push(JSON.parse(await text(entry.fileName)))
    }
  }

  return {
    manifest,
    songs,
    chordpro,
    setlists,
    async padAudio(dir) {
      const audio = new Map<string, Uint8Array<ArrayBuffer>>()
      for (const key of PAD_FILE_KEYS) {
        const entry = byName.get(`pads/${dir}/${key}.mp3`)
        if (entry) audio.set(key, await zip.read(entry))
      }
      return audio
    },
  }
}

/** What an import reads from */
function sourceOf(exported: SpaceExport): TransferSource {
  return {
    getAllSongs: async () => exported.songs,
    getChordPro: async id => {
      const content = exported.chordpro.get(id)
      return content === undefined ? undefined : { content }
    },
    getAllSetlists: async () => exported.setlists,
  }
}

/**
 * Add what an export holds to a space: the charts it lacks (the same chart is never added twice),
 * and the setlists whose ids it lacks, with their ids. Deletes nothing, and can be run again.
 */
export function importIntoSpace(
  exported: SpaceExport,
  destination: ChordlessDB
): Promise<TransferReport> {
  return transferSpace(sourceOf(exported), destination, 'import', 'import')
}

/**
 * Put pad sets from an export into Drive (the user is signed in). A pad set with the same name as
 * one in Drive replaces it. Returns the names imported.
 */
export async function importPadSets(exported: SpaceExport, names: string[]): Promise<string[]> {
  const imported: string[] = []
  for (const { name, dir } of exported.manifest.padSets) {
    if (!names.includes(name)) continue
    const audio = await exported.padAudio(dir)
    const zip = await writeZip(
      [...audio].map(([key, data]) => ({ name: `${key}.mp3`, data, compress: false }))
    )
    await uploadPadSet(new File([zip], `${name}.zip`), name)
    imported.push(name)
  }
  return imported
}
