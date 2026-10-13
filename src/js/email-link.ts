/**
 * The link the email Worker replies with: /import-setlist#<the setlist>. The parsed setlist (titles,
 * keys, CCLI numbers, the leader's name and email: never a PDF or the email itself) is compressed
 * into the fragment, which a browser never sends to a server, so only the person's own device reads
 * it. The page decodes it as untrusted input: anyone can write a link.
 */
import type { EmailPerson, ImportedSetlist, ImportedSong } from './email-setlist.ts'

/** Where a leader's email is forwarded to (see worker/src/email.ts, docs/EMAIL_IMPORT.md) */
export const IMPORT_ADDRESS = 'import@chordless.app'

const MAX_SONGS = 100
const MAX_TEXT = 500

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const writer = stream.writable.getWriter()
  writer
    .write(bytes as BufferSource)
    .then(() => writer.close())
    .catch(() => {
      // A stream that cannot be read fails the read below, which is where it is reported
    })
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

/** The setlist as text that is safe in a URL fragment */
export async function encodeImport(setlist: ImportedSetlist): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(setlist))
  return toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.slice(0, MAX_TEXT).replace(/\p{Cc}/gu, ' ') : ''
const maybe = (value: unknown): string | null => text(value) || null
const date = (value: unknown): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : ''

function person(value: unknown): EmailPerson {
  const have = (value ?? {}) as Record<string, unknown>
  return { name: text(have.name), email: text(have.email).toLowerCase() }
}

function song(value: unknown): ImportedSong {
  const have = (value ?? {}) as Record<string, unknown>
  const title = text(have.title)
  const tempo = Number(have.tempo)
  const titles = Array.isArray(have.titles)
    ? have.titles.slice(0, 10).map(text).filter(Boolean)
    : []
  return {
    title,
    titles: titles.length ? titles : [title],
    author: maybe(have.author),
    key: maybe(have.key),
    tempo: Number.isInteger(tempo) && tempo > 0 && tempo < 400 ? tempo : null,
    time: maybe(have.time),
    ccli: /^\d{4,9}$/.test(String(have.ccli)) ? String(have.ccli) : null,
    chartFilename: maybe(have.chartFilename),
    listed: maybe(have.listed),
    notes: text(have.notes),
    ...(have.pairedBy === 'elimination' ? { pairedBy: 'elimination' as const } : {}),
  }
}

/** The setlist in a link's fragment, made safe: every field is checked and cut down. Throws if it isn't one. */
export async function decodeImport(fragment: string): Promise<ImportedSetlist> {
  let have: Record<string, unknown>
  try {
    const bytes = await pipe(
      fromBase64Url(fragment.replace(/^#/, '')),
      new DecompressionStream('deflate-raw')
    )
    have = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('That link is damaged or incomplete.')
  }
  if (!have || typeof have !== 'object' || !Array.isArray(have.songs)) {
    throw new Error('That link does not hold a setlist.')
  }
  const songs = have.songs
    .slice(0, MAX_SONGS)
    .map(song)
    .filter(each => each.title)
  const unlisted = (Array.isArray(have.unlisted) ? have.unlisted : [])
    .slice(0, MAX_SONGS)
    .map(song)
    .filter(each => each.title)
  if (!songs.length && !unlisted.length) throw new Error('That link holds no songs.')
  return {
    name: text(have.name),
    date: date(have.date),
    dateWarning: maybe(have.dateWarning),
    sentDate: date(have.sentDate),
    orderFromList: have.orderFromList !== false,
    leader: person(have.leader),
    songs,
    unlisted,
  }
}
