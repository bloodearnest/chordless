/** Two devices use the real church-team API and offline sync. */
import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { SpaceDataSync, spaceDataTransport } from '../src/js/space-data.ts'
import { SpaceDataStore } from '../src/js/space-data-store.ts'
import { handleChurch } from '../worker/src/church.ts'
import type { Env } from '../worker/src/env.ts'
import { signAccessToken } from '../worker/src/session-tokens.ts'
import { handleTeamSetlists } from '../worker/src/team-setlists.ts'
import { makeSetlist, makeSong } from './builders.ts'
import { browserD1 } from './d1-browser.ts'
import { must } from './must.ts'
import { deleteDatabase } from './test-helpers.ts'

const { it } = window
it('syncs a church team between devices, preserving offline edits and local songs', async function () {
  this.timeout(15000)
  const d1 = await browserD1()
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  const env = {
    DB: d1,
    SESSION_SIGNING_KEY: key,
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    JWE_ENCRYPTION_KEY: key,
    ASSETS: { fetch: async () => new Response() },
  } as Env
  const now = new Date().toISOString()
  await d1
    .prepare('INSERT INTO accounts (account_id, created_at) VALUES (?, ?)')
    .bind('admin', now)
    .run()
  const token = await signAccessToken(
    { accountId: 'admin', sessionId: 's', email: 'admin@example.com' },
    env
  )
  const makeRequest = (path: string, method: string, body: unknown) =>
    new Request(`https://chordless.test${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const created = await handleChurch(
    makeRequest('/api/churches', 'POST', { name: 'Church', country: 'GB', city: 'York' }),
    env
  )
  const { id } = (await created.json()) as { id: string }
  const team = (
    await d1
      .prepare('SELECT space_id FROM teams WHERE church_id = ?')
      .bind(id)
      .first<{ space_id: string }>()
  )?.space_id as string
  const transport = spaceDataTransport(
    team,
    {
      origin: 'https://chordless.test',
      token: async () => token,
      fetch: (async (input, init) =>
        handleTeamSetlists(new Request(String(input), init), env)) as typeof fetch,
    },
    true
  )
  const a = new ChordlessDB(`test-team-a-${crypto.randomUUID()}`)
  const b = new ChordlessDB(`test-team-b-${crypto.randomUUID()}`)
  await a.init()
  await b.init()
  const storeA = new SpaceDataStore(a, {
    readKinds: ['setlist', 'person'],
    writeKinds: ['setlist'],
  })
  const storeB = new SpaceDataStore(b, {
    readKinds: ['setlist', 'person'],
    writeKinds: ['setlist'],
  })
  let online = true
  const syncA = new SpaceDataSync({
    store: storeA,
    transport,
    online: () => true,
    lock: work => work(),
  })
  const syncB = new SpaceDataSync({
    store: storeB,
    transport,
    online: () => online,
    lock: work => work(),
  })
  try {
    await syncA.sync()
    const localSong = await a.saveSong(makeSong({ title: 'Local chart' }))
    await a.saveSetlist(makeSetlist({ id: 'service', name: 'Initial', leaderId: '', songs: [] }))
    await syncA.sync()
    expect(must(await a.getSong(localSong.uuid)).title).to.equal('Local chart')
    await syncB.sync()
    expect(must(await b.getSetlist('service')).version).to.equal(1)
    online = false
    await b.updateSetlist('service', setlist => {
      setlist.name = 'Offline'
    })
    await syncB.sync()
    await a.updateSetlist('service', setlist => {
      setlist.time = '18:00'
    })
    await syncA.sync()
    online = true
    await syncB.sync()
    await syncA.sync()
    for (const db of [a, b])
      expect(must(await db.getSetlist('service'))).to.include({
        name: 'Offline',
        time: '18:00',
        version: 3,
      })
    expect(await storeB.pending()).to.deep.equal([])
    await d1
      .prepare(
        "UPDATE church_members SET role = 'reader' WHERE church_id = ? AND account_id = 'admin'"
      )
      .bind(id)
      .run()
    await b.updateSetlist('service', setlist => {
      setlist.name = 'Local only'
    })
    await syncB.sync()
    expect((await storeB.pending())[0].refusal?.status).to.equal('forbidden')
    expect(must(await b.getSetlist('service')).name).to.equal('Local only')
  } finally {
    a.db?.close()
    b.db?.close()
    await deleteDatabase(a.dbName)
    await deleteDatabase(b.dbName)
  }
})
