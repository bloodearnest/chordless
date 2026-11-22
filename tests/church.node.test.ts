import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleChurch } from '../worker/src/church.ts'
import type { Env } from '../worker/src/env.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')

test('a signed-in person creates a church and its library, and only admins change it', async () => {
  const { db, sql } = d1Db()
  const env = {
    DB: db,
    SESSION_SIGNING_KEY: key(),
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    JWE_ENCRYPTION_KEY: key(),
    ASSETS: { fetch: async () => new Response() },
  } satisfies Env
  const now = new Date().toISOString()
  for (const id of ['admin', 'reader', 'stranger'])
    sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(id, now)
  const token = async (id: string) =>
    signAccessToken({ accountId: id, sessionId: 's', email: `${id}@example.com` }, env)
  const call = async (who: string | null, method: string, path: string, body?: unknown) =>
    handleChurch(
      new Request(`https://chordless.test${path}`, {
        method,
        headers: who
          ? { Authorization: `Bearer ${await token(who)}`, 'Content-Type': 'application/json' }
          : {},
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env
    )
  const data = { name: ' St Mary ', country: 'GB', city: 'York', licences: { extra: true } }
  assert.equal((await call(null, 'GET', '/api/churches')).status, 401)
  assert.equal((await call('admin', 'POST', '/api/churches', { ...data, city: '' })).status, 400)
  assert.equal(
    (await call('admin', 'POST', '/api/churches', { ...data, postcode: null, ccliLicence: '' }))
      .status,
    201
  )
  assert.equal((await call('admin', 'POST', '/api/churches', { ...data, name: 'x\n' })).status, 400)
  assert.equal((await call('admin', 'POST', '/api/churches', { ...data, name: 1 })).status, 400)
  assert.equal(
    (await call('admin', 'POST', '/api/churches', { ...data, name: 'x'.repeat(201) })).status,
    400
  )
  assert.equal((await call('stranger', 'PUT', '/api/churches/missing', data)).status, 404)
  assert.equal((await call('admin', 'DELETE', '/api/churches')).status, 404)
  const response = await call('admin', 'POST', '/api/churches', data)
  assert.equal(response.status, 201)
  const { id } = (await response.json()) as { id: string }
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/)
  assert.equal(sql.prepare('SELECT count(*) AS n FROM libraries WHERE church_id = ?').get(id)?.n, 1)
  assert.equal(
    sql
      .prepare('SELECT role FROM church_members WHERE church_id = ? AND account_id = ?')
      .get(id, 'admin')?.role,
    'admin'
  )
  sql
    .prepare(
      "INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, ?, 'reader', ?)"
    )
    .run(id, 'reader', now)
  assert.equal((await call('stranger', 'GET', `/api/churches/${id}`)).status, 404)
  assert.equal((await call('reader', 'GET', `/api/churches/${id}`)).status, 200)
  assert.equal((await call('reader', 'PUT', `/api/churches/${id}`, data)).status, 403)
  assert.equal(
    (await call('admin', 'PUT', `/api/churches/${id}`, { ...data, name: 'New name' })).status,
    200
  )
  const list = (await (await call('admin', 'GET', '/api/churches')).json()) as { name: string }[]
  assert.ok(list.some(row => row.name === 'New name'))
  assert.equal(
    (await call('admin', 'POST', '/api/churches', { ...data, licences: [] })).status,
    400
  )
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), [])
  const noDb = { ...env, DB: undefined }
  assert.equal(
    (await handleChurch(new Request('https://chordless.test/api/churches'), noDb)).status,
    503
  )
})

test('a role removed during a settings request cannot write', async () => {
  const { db, sql } = d1Db()
  const env = {
    DB: db,
    SESSION_SIGNING_KEY: key(),
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    JWE_ENCRYPTION_KEY: key(),
    ASSETS: { fetch: async () => new Response() },
  } satisfies Env
  const now = new Date().toISOString()
  sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run('admin', now)
  sql
    .prepare(
      'INSERT INTO churches (church_id, name, country, city, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run('c', 'Church', 'GB', 'York', now, now)
  sql
    .prepare(
      "INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES ('c', 'admin', 'admin', ?)"
    )
    .run(now)
  const wrapped = {
    ...db,
    prepare(query: string) {
      const statement = db.prepare(query)
      if (!query.startsWith('UPDATE churches SET')) return statement
      return {
        ...statement,
        bind(...args: unknown[]) {
          const bound = statement.bind(...args)
          return {
            ...bound,
            async run() {
              sql
                .prepare(
                  "DELETE FROM church_members WHERE church_id = 'c' AND account_id = 'admin'"
                )
                .run()
              return bound.run()
            },
          }
        },
      }
    },
  }
  const token = await signAccessToken(
    { accountId: 'admin', sessionId: 's', email: 'admin@example.com' },
    env
  )
  const response = await handleChurch(
    new Request('https://chordless.test/api/churches/c', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Changed', country: 'GB', city: 'York' }),
    }),
    { ...env, DB: wrapped }
  )
  assert.equal(response.status, 403)
  assert.equal(sql.prepare("SELECT name FROM churches WHERE church_id = 'c'").get()?.name, 'Church')
})
