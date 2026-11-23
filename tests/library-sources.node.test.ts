import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeMusicXml } from '../src/js/score-musicxml.ts'
import { renderScoreHere } from '../src/js/score-render-engine.ts'
import { sha256HexOfBytes } from '../src/js/utils/bytes.ts'
import type { Env } from '../worker/src/env.ts'
import { handleLibrarySources, SHEET_READER_VERSION } from '../worker/src/library-sources.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { d1Db } from './d1-db.ts'
import { measure as m, melodyOf } from './score-build.ts'
import { svgToPdf } from './score-svg-pdf.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')

/** A lead sheet printed the way SongSelect prints them (the real ones are CCLI's and cannot be kept) */
async function leadSheet(first: string): Promise<ArrayBuffer> {
  const out = await renderScoreHere(
    writeMusicXml(
      melodyOf('Holy', [
        m(1, [`${first}:1:Ho-`, 'D4:1:ly', 'E4:1:is', 'F4:1:He'], { section: 'VERSE 1' }),
        m(2, ['G4:2:ho-', 'E4:1:ly', 'r:1'], { barline: 'final' }),
      ])
    )
  )
  assert.ok(out, 'Verovio engraved it')
  return svgToPdf(out.pages as string[])
}

/** A PDF with no lead sheet in it: valid, and nothing to read */
const emptyPdf = () =>
  new TextEncoder().encode(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF'
  ).buffer as ArrayBuffer

test('source PDFs are private, kept as they came, read once, and listed', async () => {
  const { db, sql } = d1Db()
  const now = new Date().toISOString()
  for (const account of ['admin', 'writer', 'reader', 'outsider'])
    sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(account, now)
  for (const church of ['church-a', 'church-b']) {
    sql
      .prepare(`INSERT INTO churches (church_id, name, country, city, licences, created_at, updated_at)
      VALUES (?, 'Church', 'GB', 'York', '{}', ?, ?)`)
      .run(church, now, now)
    sql
      .prepare('INSERT INTO libraries (library_id, church_id, created_at) VALUES (?, ?, ?)')
      .run(`library-${church}`, church, now)
  }
  for (const [account, role] of [
    ['admin', 'admin'],
    ['writer', 'writer'],
    ['reader', 'reader'],
  ] as const)
    sql
      .prepare(
        'INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)'
      )
      .run('church-a', account, role, now)
  sql
    .prepare('INSERT INTO libraries (library_id, account_id, created_at) VALUES (?, ?, ?)')
    .run('personal-admin', 'admin', now)
  for (const [library, song] of [
    ['library-church-a', 'song-1'],
    ['library-church-b', 'song-1'],
    ['personal-admin', 'song-1'],
  ])
    sql
      .prepare(`INSERT INTO library_songs (library_id, song_uuid, song_id, title, is_default, modified_at)
      VALUES (?, ?, 'ccli-1', 'A song', 1, ?)`)
      .run(library, song, now)

  const objects = new Map<string, ArrayBuffer | string>()
  let revokeDuringPut = false
  let raceDuringPut: string | null = null
  const env = {
    DB: db,
    SONG_BUCKET: {
      async get(objectKey: string) {
        const value = objects.get(objectKey)
        if (value === undefined) return null
        const bytes = typeof value === 'string' ? new TextEncoder().encode(value).buffer : value
        return {
          text: async () => (typeof value === 'string' ? value : new TextDecoder().decode(value)),
          arrayBuffer: async () => bytes as ArrayBuffer,
        }
      },
      async put(objectKey: string, value: string | ArrayBuffer) {
        objects.set(objectKey, value)
        if (raceDuringPut !== null && objectKey.endsWith('.pdf')) {
          // (the same PDF of the song, from another device, lands first)
          sql
            .prepare(`INSERT INTO library_song_sources (library_id, song_uuid, sha256, size_bytes, pdf_ref, origin, imported_at, imported_by)
            VALUES ('library-church-a', 'song-1', ?, 1, ?, 'file', ?, 'admin')`)
            .run(raceDuringPut, objectKey, now)
          raceDuringPut = null
        }
        if (revokeDuringPut) {
          sql.prepare("DELETE FROM church_members WHERE account_id = 'writer'").run()
          revokeDuringPut = false
        }
      },
    },
    SESSION_SIGNING_KEY: key(),
    JWE_ENCRYPTION_KEY: key(),
    GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    ASSETS: { fetch: async () => new Response() },
  } satisfies Env
  const send = async (
    account: string | null,
    method: string,
    path: string,
    body?: ArrayBuffer,
    headers: Record<string, string> = {}
  ) =>
    handleLibrarySources(
      new Request(`https://example.test${path}`, {
        method,
        headers: {
          ...(account === null
            ? {}
            : {
                Authorization: `Bearer ${await signAccessToken({ accountId: account, sessionId: 's', email: `${account}@example.com` }, env)}`,
              }),
          ...(body === undefined ? {} : { 'Content-Type': 'application/pdf' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
      }),
      env
    )
  const base = '/api/libraries/library-church-a/songs/song-1/sources'
  const pdf = await leadSheet('C4')
  const hash = await sha256HexOfBytes(pdf)

  // Who may: a member reads, a writer adds, nobody else does anything
  assert.equal((await send(null, 'GET', base)).status, 401)
  assert.equal((await send('outsider', 'GET', base)).status, 404)
  assert.equal((await send('outsider', 'POST', base, pdf)).status, 404)
  assert.equal((await send('reader', 'POST', base, pdf)).status, 403)
  assert.equal(
    (await send('writer', 'GET', '/api/libraries/library-church-a/songs/none/sources')).status,
    404
  )
  assert.deepEqual(await (await send('reader', 'GET', base)).json(), { sources: [] })

  // What is not a PDF, or is too big
  assert.equal(
    (await send('writer', 'POST', base, pdf, { 'Content-Type': 'text/plain' })).status,
    415
  )
  assert.equal(
    (await send('writer', 'POST', base, pdf, { 'Content-Length': String(2 * 1024 * 1024) })).status,
    413
  )
  assert.equal((await send('writer', 'POST', `${base}?name=${'x'.repeat(201)}`, pdf)).status, 400)
  assert.equal((await send('writer', 'DELETE', base)).status, 404)
  // (a request with no content type at all)
  const untyped = await handleLibrarySources(
    new Request(`https://example.test${base}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await signAccessToken({ accountId: 'writer', sessionId: 's', email: 'writer@example.com' }, env)}`,
      },
      body: pdf,
    }),
    env
  )
  assert.equal(untyped.status, 415)
  assert.equal(
    (await send('writer', 'POST', base, new TextEncoder().encode('hello').buffer as ArrayBuffer))
      .status,
    400
  )
  assert.equal((await send('writer', 'POST', base, new ArrayBuffer(1024 * 1024 + 1))).status, 413)
  assert.equal((await send('writer', 'POST', `${base}?origin=Bad!`, pdf)).status, 400)
  assert.equal(objects.size, 0, 'nothing was kept of what was refused')

  // A lead sheet is kept as it came and read: what was read is kept beside it
  const added = await send('writer', 'POST', `${base}?origin=songselect&name=Holy.pdf`, pdf)
  assert.equal(added.status, 201)
  const { source } = (await added.json()) as { source: Record<string, unknown> }
  assert.equal(source.sha256, hash)
  assert.equal(source.sizeBytes, pdf.byteLength)
  assert.equal(source.origin, 'songselect')
  assert.equal(source.fileName, 'Holy.pdf')
  assert.equal(source.parsed, true)
  assert.equal(source.parseReader, SHEET_READER_VERSION)
  assert.equal(objects.size, 2)
  assert.ok(objects.has(`library/library-church-a/songs/song-1/sources/${hash}.pdf`))

  // The same PDF again is the same source: nothing is written
  const again = await send('admin', 'POST', base, pdf)
  assert.equal(again.status, 200)
  assert.deepEqual(((await again.json()) as { source: unknown }).source, source)
  assert.equal(objects.size, 2)

  // A different PDF is another source, and one with nothing to read is kept all the same
  const nothing = await send('writer', 'POST', base, emptyPdf())
  assert.equal(nothing.status, 201)
  const unread = ((await nothing.json()) as { source: Record<string, unknown> }).source
  assert.equal(unread.parsed, false)
  assert.equal(unread.parseReader, null)
  assert.equal(unread.fileName, null)
  const listed = (await (await send('reader', 'GET', base)).json()) as {
    sources: { sha256: string }[]
  }
  assert.equal(listed.sources.length, 2)

  // It can be fetched back: the PDF byte for byte, and what was read
  const downloaded = await send('reader', 'GET', `${base}/${hash}/pdf`)
  assert.equal(downloaded.headers.get('Content-Type'), 'application/pdf')
  assert.equal(await sha256HexOfBytes(await downloaded.arrayBuffer()), hash)
  const xml = await (await send('reader', 'GET', `${base}/${hash}/musicxml`)).text()
  assert.match(xml, /<score-partwise/)
  assert.equal((await send('reader', 'GET', `${base}/${unread.sha256}/musicxml`)).status, 404)
  assert.equal((await send('reader', 'GET', `${base}/${'0'.repeat(64)}`)).status, 404)
  assert.equal(
    (await send('reader', 'GET', `${base}/${hash}`)).headers.get('Cache-Control'),
    'private, no-store'
  )

  // A source of one library is not seen from another, or by someone who is not in the church
  assert.equal(
    (await send('writer', 'GET', '/api/libraries/library-church-b/songs/song-1/sources')).status,
    404
  )
  assert.equal(
    (await send('admin', 'GET', '/api/libraries/personal-admin/songs/song-1/sources')).status,
    200
  )
  assert.equal(
    (await send('writer', 'GET', '/api/libraries/personal-admin/songs/song-1/sources')).status,
    404
  )
  assert.equal(
    (await send('admin', 'POST', '/api/libraries/personal-admin/songs/song-1/sources', pdf)).status,
    201
  )

  // Content that went missing, or changed, is not served
  objects.set(`library/library-church-a/songs/song-1/sources/${hash}.pdf`, emptyPdf())
  assert.equal((await send('reader', 'GET', `${base}/${hash}/pdf`)).status, 503)
  objects.delete(`library/library-church-a/songs/song-1/sources/${hash}.pdf`)
  assert.equal((await send('reader', 'GET', `${base}/${hash}/pdf`)).status, 503)

  // The same PDF arriving from two devices at once: one row, and both are told it is kept
  const raced = await leadSheet('E4')
  raceDuringPut = await sha256HexOfBytes(raced)
  assert.equal((await send('writer', 'POST', base, raced)).status, 200)
  assert.equal(
    sql
      .prepare('SELECT count(*) AS n FROM library_song_sources WHERE library_id = ?')
      .get('library-church-a')?.n,
    3
  )

  // Access that ends while it is being written is refused, and leaves no row
  revokeDuringPut = true
  assert.equal((await send('writer', 'POST', base, await leadSheet('A4'))).status, 403)
  assert.equal(
    sql
      .prepare('SELECT count(*) AS n FROM library_song_sources WHERE library_id = ?')
      .get('library-church-a')?.n,
    3
  )
  assert.equal((await send('writer', 'GET', base)).status, 404)
})

test('the sources handler refuses a path that is not its own', async () => {
  const env = {
    SESSION_SIGNING_KEY: key(),
    JWE_ENCRYPTION_KEY: key(),
    GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    ASSETS: { fetch: async () => new Response() },
  } satisfies Env
  const response = await handleLibrarySources(new Request('https://example.test/api/other'), env)
  assert.equal(response.status, 404)
})
