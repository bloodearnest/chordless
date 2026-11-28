/**
 * Joining a church team's live room (worker/src/church-team-live.ts): who is let in, by their church, and the room's
 * own check of each message (`roleIn`). The room itself (team-room.ts) is tested in workerd.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { LIVE_PROTOCOL } from '../src/js/live-protocol.ts'
import { handleChurch } from '../worker/src/church.ts'
import {
  churchLivePath,
  churchTeamRole,
  handleChurchLive,
  roleIn,
} from '../worker/src/church-team-live.ts'
import type { Env } from '../worker/src/env.ts'
import { handleRequest } from '../worker/src/router.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { d1Db } from './d1-db.ts'

const key = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
const ORIGIN = 'https://chordless.test'

/** A church with a team, its members, an outsider, and the team's room, noting what reaches it */
async function church() {
  const { db, sql } = d1Db()
  const sent: Request[] = []
  const asked: string[] = []
  const env = {
    DB: db,
    SESSION_SIGNING_KEY: key(),
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    JWE_ENCRYPTION_KEY: key(),
    ASSETS: { fetch: async () => new Response() },
    TEAM_ROOM: {
      idFromName(name: string) {
        asked.push(name)
        return name
      },
      get: () => ({
        fetch: async (request: Request) => {
          sent.push(request)
          return new Response('socket')
        },
      }),
    },
  } as unknown as Env
  const now = new Date().toISOString()
  for (const id of ['admin', 'reader', 'outsider'])
    sql.prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)').run(id, now)
  const token = (who: string) =>
    signAccessToken({ accountId: who, sessionId: 's', email: `${who}@example.com` }, env)
  const made = await handleChurch(
    new Request(`${ORIGIN}/api/churches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await token('admin')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Church', country: 'GB', city: 'York' }),
    }),
    env
  )
  const { id } = (await made.json()) as { id: string }
  sql
    .prepare(
      'INSERT INTO church_members (church_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)'
    )
    .run(id, 'reader', 'reader', now)
  const team = sql.prepare('SELECT space_id FROM teams WHERE church_id = ?').get(id)
    ?.space_id as string
  const join = async (who: string | null, extra: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/api/teams/${team}/live`, {
      headers: {
        Upgrade: 'websocket',
        ...(who === null
          ? {}
          : { 'Sec-WebSocket-Protocol': `${LIVE_PROTOCOL}, ${await token(who)}` }),
        ...extra,
      },
    })
  return { db, sql, env, team, church: id, sent, asked, join }
}

describe('churchLivePath', () => {
  test('reads the team from the path, and nothing else', () => {
    assert.equal(churchLivePath('/api/teams/T1/live'), 'T1')
    assert.equal(churchLivePath('/api/teams/T1/data'), null)
    assert.equal(churchLivePath('/api/teams/T1/live/more'), null)
    assert.equal(churchLivePath('/api/space/T1/live'), null)
    assert.equal(churchLivePath('/api/teams/a%2Fb/live'), null)
  })
})

describe('handleChurchLive', () => {
  test("lets a member of the team's church into the team's room, as who they are", async () => {
    const { env, team, sent, asked, join } = await church()
    const answer = await handleChurchLive(await join('reader'), team, env)
    assert.equal(await answer.text(), 'socket')
    assert.deepEqual(asked, [team])
    assert.deepEqual(JSON.parse(sent[0].headers.get('X-Live-Identity') ?? ''), {
      provider: 'chordless',
      sub: 'reader',
      spaceId: team,
    })
    assert.equal(sent[0].headers.get('Sec-WebSocket-Protocol'), LIVE_PROTOCOL)
    // (nothing the browser sent reaches the room: only what the Worker settled)
    assert.equal(sent[0].headers.get('Authorization'), null)
  })

  test('is reached through the router', async () => {
    const { env, sent, join } = await church()
    const cache = { match: async () => undefined, put: async () => {} }
    const answer = await handleRequest(await join('admin'), env, { waitUntil() {} }, cache)
    assert.equal(await answer.text(), 'socket')
    assert.equal(sent.length, 1)
  })

  test('refuses someone not of the church, or no one, and a team that is not there, alike', async () => {
    const { env, team, sent, join } = await church()
    assert.equal((await handleChurchLive(await join('outsider'), team, env)).status, 404)
    assert.equal((await handleChurchLive(await join('admin'), 'NOTEAM', env)).status, 404)
    assert.equal((await handleChurchLive(await join(null), team, env)).status, 401)
    const forged = await join(null, { 'Sec-WebSocket-Protocol': `${LIVE_PROTOCOL}, not-a-token` })
    assert.equal((await handleChurchLive(forged, team, env)).status, 401)
    assert.equal(sent.length, 0)
  })

  test('refuses a team that has ended', async () => {
    const { env, sql, team, join } = await church()
    sql
      .prepare('UPDATE teams SET ended_at = ? WHERE space_id = ?')
      .run(new Date().toISOString(), team)
    assert.equal((await handleChurchLive(await join('admin'), team, env)).status, 404)
  })

  test('is only a socket, and says so when there is no room to join', async () => {
    const { env, team, join } = await church()
    const plain = new Request(`${ORIGIN}/api/teams/${team}/live`)
    assert.equal((await handleChurchLive(plain, team, env)).status, 426)
    const roomless = { ...env, TEAM_ROOM: undefined } as Env
    assert.equal((await handleChurchLive(await join('admin'), team, roomless)).status, 503)
  })
})

describe('roleIn', () => {
  test("is a church member's church role, and none for anyone else", async () => {
    const { db, team } = await church()
    assert.equal(await churchTeamRole(db, team, 'reader'), 'reader')
    assert.equal(await roleIn(db, { provider: 'chordless', sub: 'admin', spaceId: team }), 'admin')
    assert.equal(await roleIn(db, { provider: 'chordless', sub: 'outsider', spaceId: team }), null)
    // (a Google login is a Drive team's member or nothing: the church knows accounts)
    assert.equal(await roleIn(db, { provider: 'google', sub: 'admin', spaceId: team }), null)
  })

  test("is not a Drive team's role once the team is a church's: the church says who is in it", async () => {
    const { db, sql, team } = await church()
    sql
      .prepare(
        'INSERT INTO team_members (space_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)'
      )
      .run(team, 'outsider', 'writer', new Date().toISOString())
    assert.equal(await roleIn(db, { provider: 'chordless', sub: 'outsider', spaceId: team }), null)
  })
})
