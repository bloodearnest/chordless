/**
 * The team space from end to end, with the real code on both sides of the wire: the page's sync
 * and storage client, the Worker's router and team API, the Durable Object's rules (over a Map) and
 * the owner's Drive (FakeDrive). Only Google is faked: its Drive, and the check of an ID token.
 *
 * The other tests of the team service each run one side against a fake of the other, which is how
 * the two sides could disagree (what a space's root is called, whose data a first sync takes)
 * with every test passing. Anything that crosses the wire belongs here.
 */
import { expect } from '@open-wc/testing'
import { ChordlessDB } from '../src/js/db.ts'
import { createTeamFolder, driveApi } from '../src/js/drive-api.ts'
import { addChart } from '../src/js/song-utils.ts'
import { deleteSpace, getSpaceById } from '../src/js/space.ts'
import { storageFor } from '../src/js/storage/space-storage.ts'
import { createSyncOrchestrator } from '../src/js/sync-orchestrator.ts'
import { teamApi } from '../src/js/team-client.ts'
import { createTeamSpace, joinSpace, syncTeamSpace } from '../src/js/team-spaces.ts'
import { encryptBlob } from '../worker/src/blob.ts'
import type { Env } from '../worker/src/env.ts'
import type { IdentityProvider } from '../worker/src/identity.ts'
import { handleRequest } from '../worker/src/router.ts'
import { TeamSpaceState } from '../worker/src/team-state.ts'
import { makeSetlist } from './builders.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { installFakeDrive } from './fake-drive.ts'
import { MapStore } from './map-store.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const DRIVE_TOKEN = 'fake-drive-token'
const ISSUER = 'https://accounts.google.com'
const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
const ann = { sub: 'g-ann', email: 'ann@example.com', name: 'Ann Owner' }
const bob = { sub: 'g-bob', email: 'bob@example.com', name: 'Bob Member' }
type Person = typeof ann

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** An ID token the stand-in for Google's check accepts: the claims are what it reads */
const idTokenFor = ({ sub, email }: Person) =>
  `${encode({ alg: 'RS256' })}.${encode({
    iss: ISSUER,
    sub,
    email,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`

describe('a team space, end to end', () => {
  let drive: ReturnType<typeof installFakeDrive>
  let auth: ReturnType<typeof installFakeAuthWorker>
  let worker: FakeAuthWorker
  const realFetch = window.fetch
  let objects: Map<string, TeamSpaceState>
  const made: string[] = []
  const dbs: ChordlessDB[] = []

  /** Sign in as this person on this device */
  async function signInAs(person: Person, withBlob = false) {
    worker.stored = {
      blob: withBlob
        ? await encryptBlob(
            {
              owner_email: person.email,
              owner_sub: person.sub,
              scopes: 'drive.file',
              refresh_token: 'refresh',
              created_at: '2026-10-22T00:00:00Z',
              blob_id: crypto.randomUUID(),
              kid: 'default',
            },
            { JWE_ENCRYPTION_KEY: KEY }
          )
        : 'member-blob',
      metadata: {
        access_token: DRIVE_TOKEN,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        id_token: idTokenFor(person),
        scope: 'https://www.googleapis.com/auth/drive.file openid email profile',
        user: { ...person, picture: null, given_name: null, family_name: null },
      },
      updated_at: new Date().toISOString(),
    }
  }

  async function open(spaceId: string) {
    const db = new ChordlessDB(spaceId)
    await db.init()
    dbs.push(db)
    return db
  }

  beforeEach(() => {
    drive = installFakeDrive()
    auth = installFakeAuthWorker()
    worker = auth.worker
    objects = new Map()

    // The Worker: its router over Durable Objects that are a state over a Map, with Google's
    // check of an ID token replaced by reading the claims, and its Drive the same FakeDrive
    const provider: IdentityProvider = {
      id: 'google',
      issuers: [ISSUER],
      verify: async token => {
        const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        return { provider: 'google', sub: claims.sub, email: claims.email }
      },
    }
    const env = {
      GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
      JWE_ENCRYPTION_KEY: KEY,
      ASSETS: { fetch: async () => new Response('assets') },
      TEAM_SPACE: {
        idFromName: (name: string) => name,
        get(id: unknown) {
          const name = String(id)
          const state = objects.get(name) ?? new TeamSpaceState(new MapStore())
          objects.set(name, state)
          return state
        },
      },
    } as unknown as Env
    const deps = {
      providers: [provider],
      google: {
        refreshAccessToken: async () => ({ access_token: DRIVE_TOKEN, expires_in: 3600 }),
      } as never,
      fetch: ((input, init) => drive.handle(input, init)) as typeof fetch,
    }
    const cache = { match: async () => undefined, put: async () => {} }
    const pageFetch = window.fetch
    window.fetch = ((input, init) => {
      const url = new URL(
        typeof input === 'string' || input instanceof URL ? input : input.url,
        location.href
      )
      return url.pathname.startsWith('/api/')
        ? handleRequest(new Request(url, init), env, { waitUntil() {} }, cache, undefined, deps)
        : pageFetch(input, init)
    }) as typeof fetch
  })

  afterEach(async () => {
    for (const db of dbs.splice(0)) db.db?.close()
    window.fetch = realFetch
    drive.uninstall()
    auth.uninstall()
    for (const id of made.splice(0)) await deleteSpace(id).catch(() => {})
  })

  it('has a member get what the owner saved, and the owner get what the member adds', async () => {
    // The owner makes the space, with a song and a setlist in it, and saves it to Drive
    await signInAs(ann, true)
    const parent = await createTeamFolder('root', 'Church Drive')
    const name = `Contract ${crypto.randomUUID().slice(0, 8)}`
    const owned = await createTeamSpace(name, parent, driveApi)
    made.push(owned.id)
    const team = must(owned.team)
    const ownerDb = await open(owned.id)
    const song = await addChart(ownerDb, '{title: Alpha}\n{key: G}\n[G]Alpha line', {
      variantLabel: 'Original',
      importSource: 'test',
      makeDefault: 'first',
    })
    await ownerDb.saveSetlist(
      makeSetlist({
        id: 'sunday',
        date: '2026-12-06',
        name: 'Sunday',
        songs: [{ order: 0, songId: song.id, songUuid: song.uuid, key: 'A' } as never],
      })
    )
    await syncTeamSpace(must(await getSpaceById(owned.id)))
    expect(drive.listFiles(file => file.appProperties.setlistId === 'sunday')).to.have.length(1)

    // They invite the member, who joins and syncs on their own device
    const { code } = await teamApi.createInvite(team.id, 'writer', bob.email)
    await signInAs(bob)
    const joined = await joinSpace(
      team.id,
      code,
      storageFor({ team: { id: team.id, role: 'reader' } })
    )
    made.push(joined.id)
    // The root a member knows the space by is the space's id, not the owner's folder behind it
    expect(joined.rootRef).to.equal(team.id)
    await syncTeamSpace(must(await getSpaceById(joined.id)))

    const memberDb = await open(joined.id)
    expect(must(await memberDb.getSetlist('sunday')).name).to.equal('Sunday')
    expect((await memberDb.getAllSongs()).map(each => each.title)).to.deep.equal(['Alpha'])

    // Nothing the member did went to any object but the space's own
    expect([...objects.keys()]).to.deep.equal([team.id])

    // The member changes the setlist and adds one, and the owner gets both
    const sunday = must(await memberDb.getSetlist('sunday'))
    await memberDb.saveSetlist({
      ...sunday,
      name: 'Sunday (changed)',
      modifiedDate: new Date().toISOString(),
    })
    await memberDb.saveSetlist(makeSetlist({ id: 'extra', date: '2026-12-13', name: 'Extra' }))
    await syncTeamSpace(must(await getSpaceById(joined.id)))

    await signInAs(ann, true)
    await syncTeamSpace(must(await getSpaceById(owned.id)))
    expect(must(await ownerDb.getSetlist('sunday')).name).to.equal('Sunday (changed)')
    expect(must(await ownerDb.getSetlist('extra')).name).to.equal('Extra')
    expect([...objects.keys()]).to.deep.equal([team.id])
  })

  it('has a member who has synced get the owner’s later changes from the feed, listing nothing', async () => {
    await signInAs(ann, true)
    const parent = await createTeamFolder('root', 'Church Drive')
    const owned = await createTeamSpace(
      `Contract ${crypto.randomUUID().slice(0, 8)}`,
      parent,
      driveApi
    )
    made.push(owned.id)
    const team = must(owned.team)
    const ownerDb = await open(owned.id)
    await ownerDb.saveSetlist(makeSetlist({ id: 'sunday', date: '2026-12-06', name: 'Before' }))
    await syncTeamSpace(must(await getSpaceById(owned.id)))

    const { code } = await teamApi.createInvite(team.id, 'reader', bob.email)
    await signInAs(bob)
    const joined = await joinSpace(
      team.id,
      code,
      storageFor({ team: { id: team.id, role: 'reader' } })
    )
    made.push(joined.id)
    await syncTeamSpace(must(await getSpaceById(joined.id)))
    const memberDb = await open(joined.id)
    expect(must(await memberDb.getSetlist('sunday')).name).to.equal('Before')
    expect(must((await getSpaceById(joined.id))?.changesToken)).to.be.a('string')

    // The owner changes the setlist and adds one: the member's next sync is from the feed
    await signInAs(ann, true)
    await ownerDb.saveSetlist({
      ...must(await ownerDb.getSetlist('sunday')),
      name: 'After',
      modifiedDate: new Date().toISOString(),
    })
    await ownerDb.saveSetlist(makeSetlist({ id: 'late', date: '2026-12-13', name: 'Late' }))
    await syncTeamSpace(must(await getSpaceById(owned.id)))

    await signInAs(bob)
    const member = must(await getSpaceById(joined.id))
    drive.requests.length = 0
    const orchestrator = await createSyncOrchestrator(member.name, member.id)
    await orchestrator.incrementalSync()

    expect(must(await memberDb.getSetlist('sunday')).name).to.equal('After')
    expect(must(await memberDb.getSetlist('late')).name).to.equal('Late')
    const paths = drive.requests.map((request: { path: string }) => request.path)
    expect(paths.some((path: string) => path.endsWith('/changes'))).to.equal(true)
    // It read the feed, and listed only the space's folders to tell which collection a file is in:
    // never a collection's files
    const lists = drive.requests.filter(
      (request: { path: string; params: URLSearchParams }) =>
        request.path.endsWith('/files') && request.params.has('q')
    )
    expect(lists).to.have.length(1)
    expect(lists[0].params.get('q')).to.contain("mimeType='application/vnd.google-apps.folder'")
  })

  it('refuses someone who is not in the space, and says who and which space', async () => {
    await signInAs(ann, true)
    const parent = await createTeamFolder('root', 'Church Drive')
    const owned = await createTeamSpace(
      `Contract ${crypto.randomUUID().slice(0, 8)}`,
      parent,
      driveApi
    )
    made.push(owned.id)
    const team = must(owned.team)

    await signInAs(bob)
    const error = await storageFor({ team: { id: team.id, role: 'reader' } })
      .inspectRoot(team.id)
      .catch(failure => failure as Error)
    expect(error).to.be.instanceOf(Error)
    expect((error as Error).message).to.equal(
      `Not a member of this space (signed in as bob@example.com, space ${team.id})`
    )
  })
})
