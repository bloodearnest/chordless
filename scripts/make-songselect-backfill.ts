/**
 * Makes the script to run in the Chrome console on SongSelect that fetches a library's charts and
 * lead sheets again (docs/RANGE.md, "Re-importing a whole library"): scripts/songselect-backfill.js, with the CCLI numbers of
 * the songs in a Chordless export after it.
 *
 *   node scripts/make-songselect-backfill.ts chordless-export-Church-2026-10-23.zip --out backfill.js
 *   node scripts/make-songselect-backfill.ts chordless-export-Church-2026-10-23.zip > backfill.js
 *
 * The export is the zip that Account and Teams makes of a space. Songs with no CCLI number (those
 * made by hand) are left out, and listed; a song added after the export is not in it, so export
 * again for those.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { readZip } from '../src/js/utils/zip.ts'

/** A song of the library, as the script is given it: its CCLI number and its title (for its log) */
export type LibrarySong = [ccli: string, title: string]

interface ExportedSong {
  ccliNumber: string | null
  title: string
  isDefault: boolean
}

async function textOf(zip: Awaited<ReturnType<typeof readZip>>, name: string): Promise<string> {
  const entry = zip.entries.find(each => each.fileName === name)
  if (!entry) throw new Error(`That is not a Chordless export: it has no ${name}`)
  return new TextDecoder().decode(await zip.read(entry))
}

/**
 * The songs of an export that have a CCLI number, once each (a song's variants share its number;
 * the title is the default variant's), in order of title; and the titles of those with none
 */
export async function songsOfExport(
  file: Blob
): Promise<{ songs: LibrarySong[]; withoutCcli: string[]; created: string | null }> {
  const zip = await readZip(file)
  const records: ExportedSong[] = JSON.parse(await textOf(zip, 'songs.json'))
  const manifest = JSON.parse(await textOf(zip, 'manifest.json')) as { created?: string }

  const byNumber = new Map<string, ExportedSong>()
  const withoutCcli: string[] = []
  for (const record of records) {
    if (!record.ccliNumber) {
      withoutCcli.push(record.title)
      continue
    }
    const have = byNumber.get(record.ccliNumber)
    if (!have || (record.isDefault && !have.isDefault)) byNumber.set(record.ccliNumber, record)
  }
  const songs = [...byNumber].map(([ccli, record]): LibrarySong => [ccli, record.title])
  songs.sort((a, b) => a[1].localeCompare(b[1]))
  return { songs, withoutCcli, created: manifest.created ?? null }
}

/** The script to paste into the console: the backfill script, and the call that runs it on these */
export function backfillScript(songs: LibrarySong[], template: string, made = new Date()): string {
  const list = songs.map(song => `  ${JSON.stringify(song)},`).join('\n')
  return (
    `// Made by scripts/make-songselect-backfill.ts on ${made.toISOString().slice(0, 10)}: ` +
    `${songs.length} songs. Paste into the console on https://songselect.ccli.com.\n\n` +
    `${template.trimEnd()}\n\nsongSelectBackfill([\n${list}\n])\n`
  )
}

if (process.argv[1] === import.meta.filename) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' } },
  })
  const [exportPath] = positionals
  if (!exportPath) {
    console.error('Usage: node scripts/make-songselect-backfill.ts <export.zip> [--out script.js]')
    process.exit(1)
  }
  const { songs, withoutCcli, created } = await songsOfExport(new Blob([readFileSync(exportPath)]))
  const template = readFileSync(new URL('./songselect-backfill.js', import.meta.url), 'utf8')
  const script = backfillScript(songs, template)
  if (values.out) writeFileSync(values.out, script)
  else process.stdout.write(script)
  console.error(`${songs.length} songs with a CCLI number go in the script.`)
  if (withoutCcli.length) {
    console.error(`${withoutCcli.length} have none, and are left out: ${withoutCcli.join(', ')}`)
  }
  if (created) {
    console.error(`The export is from ${created.slice(0, 10)}: songs added since are not in it.`)
  }
}
