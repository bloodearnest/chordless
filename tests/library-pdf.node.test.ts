import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeMusicXml } from '../src/js/score-musicxml.ts'
import { renderScoreHere } from '../src/js/score-render-engine.ts'
import type { Env } from '../worker/src/env.ts'
import { handleLibraryPdf } from '../worker/src/library-pdf.ts'
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

test('a library song keeps one source PDF, private, replaced by the next, and read on the server', async () => {
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
  for (const library of ['library-church-a', 'library-church-b', 'personal-admin'])
    sql
      .prepare(`INSERT INTO library_songs (library_id, song_uuid, song_id, title, is_default, modified_at)
      VALUES (?, 'song-1', 'ccli-1', 'A song', 1, ?)`)
      .run(library, now)

  const objects = new Map<string, { value: ArrayBuffer | string; meta?: Record<string, string> }>()
  const env = {
    DB: db,
    SONG_BUCKET: {
      async list({ prefix, limit }: { prefix: string; limit?: number }) {
        const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort()
        return { objects: keys.slice(0, limit).map(k => ({ key: k, size: 0 })) }
      },
      async get(objectKey: string) {
        const found = objects.get(objectKey)
        if (found === undefined) return null
        const { value } = found
        return {
          text: async () => (typeof value === 'string' ? value : new TextDecoder().decode(value)),
          arrayBuffer: async () =>
            (typeof value === 'string'
              ? new TextEncoder().encode(value).buffer
              : value) as ArrayBuffer,
          body: new Blob([value]).stream(),
        }
      },
      async delete() {},
      async put(
        objectKey: string,
        value: string | ArrayBuffer | Blob,
        options?: { customMetadata?: Record<string, string> }
      ) {
        objects.set(objectKey, {
          value: value as ArrayBuffer | string,
          meta: options?.customMetadata,
        })
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
    headers: Record<string, string> = { 'Content-Type': 'application/pdf' }
  ) =>
    handleLibraryPdf(
      new Request(`https://example.test${path}`, {
        method,
        headers: {
          ...(account === null
            ? {}
            : {
                Authorization: `Bearer ${await signAccessToken({ accountId: account, sessionId: 's', email: `${account}@example.com` }, env)}`,
              }),
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
      }),
      env
    )
  const path = '/api/libraries/library-church-a/songs/song-1/pdf'
  const prefix = 'library/library-church-a/songs/song-1/pdf/'
  const stored = () => [...objects.keys()].filter(k => k.startsWith(prefix)).sort()
  const later = () => new Promise(done => setTimeout(done, 5))
  const pdf = await leadSheet('C4')

  // Who may: a member reads, a writer adds, nobody else does anything
  assert.equal((await send(null, 'GET', path)).status, 401)
  assert.equal((await send('outsider', 'GET', path)).status, 404)
  assert.equal((await send('outsider', 'PUT', path, pdf)).status, 404)
  assert.equal((await send('reader', 'PUT', path, pdf)).status, 403)
  assert.equal(
    (await send('writer', 'GET', '/api/libraries/library-church-a/songs/none/pdf')).status,
    404
  )
  assert.equal((await send('reader', 'GET', path)).status, 404, 'no PDF yet')
  assert.equal((await send('reader', 'DELETE', path)).status, 404)

  // What is not a PDF, or is too big, is refused and kept nowhere
  const refused = async (
    status: number,
    ...args: Parameters<typeof send> extends [string | null, ...infer R] ? R : never
  ) => assert.equal((await send('writer', ...args)).status, status)
  await refused(400, 'PUT', path, new TextEncoder().encode('hello').buffer as ArrayBuffer)
  await refused(413, 'PUT', path, new ArrayBuffer(1024 * 1024 + 1))
  await refused(413, 'PUT', path, pdf, {
    'Content-Type': 'application/pdf',
    'Content-Length': String(2 * 1024 * 1024),
  })
  await refused(415, 'PUT', path, pdf, { 'Content-Type': 'text/plain' })
  await refused(400, 'PUT', `${path}?origin=Bad!`, pdf)
  await refused(400, 'PUT', `${path}?name=${'x'.repeat(201)}`, pdf)
  const untyped = await handleLibraryPdf(
    new Request(`https://example.test${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${await signAccessToken({ accountId: 'writer', sessionId: 's', email: 'writer@example.com' }, env)}`,
      },
      body: pdf,
    }),
    env
  )
  assert.equal(untyped.status, 415)
  assert.equal(objects.size, 0)

  // It is kept as it came, with who imported it and how, and what was read from it comes back
  const added = await send('writer', 'PUT', `${path}?origin=songselect&name=Holy.pdf`, pdf)
  assert.equal(added.status, 200)
  assert.equal(added.headers.get('Cache-Control'), 'private, no-store')
  const body = (await added.json()) as { sizeBytes: number; musicxml: string }
  assert.equal(body.sizeBytes, pdf.byteLength)
  assert.match(body.musicxml, /<score-partwise/)
  assert.equal(stored().length, 1)
  assert.match(stored()[0], /\/pdf\/\d{13}-[0-9a-f]{8}\.pdf$/)
  const meta = objects.get(stored()[0])?.meta
  assert.equal(meta?.origin, 'songselect')
  assert.equal(meta?.name, 'Holy.pdf')
  assert.equal(meta?.importedBy, 'writer')
  assert.match(meta?.importedAt ?? '', /^\d{4}-\d\d-\d\dT/)

  // Any member fetches it back, byte for byte
  const downloaded = await send('reader', 'GET', path)
  assert.equal(downloaded.headers.get('Content-Type'), 'application/pdf')
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), new Uint8Array(pdf))

  // The next import is the song's PDF, and the one before is kept, unchanged (a PDF with no lead
  // sheet in it is kept all the same)
  await later()
  const replaced = await send('admin', 'PUT', path, emptyPdf())
  assert.equal(replaced.status, 200)
  assert.equal(((await replaced.json()) as { musicxml: unknown }).musicxml, null)
  assert.equal(stored().length, 2)
  const [newest, earlier] = stored()
  assert.equal(objects.get(newest)?.meta?.origin, 'file')
  assert.equal(objects.get(newest)?.meta?.name, undefined)
  assert.equal(objects.get(newest)?.meta?.importedBy, 'admin')
  assert.deepEqual(new Uint8Array(objects.get(earlier)?.value as ArrayBuffer), new Uint8Array(pdf))
  assert.deepEqual(
    new Uint8Array(await (await send('reader', 'GET', path)).arrayBuffer()),
    new Uint8Array(emptyPdf())
  )

  // Two at once are two objects, and neither is lost
  await later()
  await Promise.all([send('writer', 'PUT', path, pdf), send('admin', 'PUT', path, emptyPdf())])
  assert.equal(stored().length, 4)

  // One library's PDF is not another's
  assert.equal(
    (await send('writer', 'GET', '/api/libraries/library-church-b/songs/song-1/pdf')).status,
    404
  )
  assert.equal(
    (await send('writer', 'GET', '/api/libraries/personal-admin/songs/song-1/pdf')).status,
    404
  )
  assert.equal(
    (await send('admin', 'PUT', '/api/libraries/personal-admin/songs/song-1/pdf', pdf)).status,
    200
  )
  assert.equal(objects.size, 5)

  // A path that is not its own
  const other = await handleLibraryPdf(new Request('https://example.test/api/other'), env)
  assert.equal(other.status, 404)
})
