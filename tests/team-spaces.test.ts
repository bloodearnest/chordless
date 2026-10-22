/**
 * Team spaces on this device: the Worker's routes as the page calls them (team-client.ts), which
 * backend a space is reached through (space-storage.ts), and sharing and joining (team-spaces.ts).
 * The Worker is a fetch that answers from a table, and the service worker that keeps the sign-in
 * a fake one (fake-auth-worker.ts).
 */
import { expect } from '@open-wc/testing'
import type { Space } from '../src/js/data-types.ts'
import { createSyncManager, isSyncAvailable } from '../src/js/drive-sync.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  getSpaceById,
  listSpaces,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
import { driveStorage } from '../src/js/storage/browser-drive.ts'
import { isTeamMember, storageFor } from '../src/js/storage/space-storage.ts'
import { TeamStorage } from '../src/js/storage/team-storage.ts'
import { TeamError, teamApi } from '../src/js/team-client.ts'
import {
  createTeamSpace,
  inviteLink,
  joinSpace,
  leaveSpace,
  outranks,
  stopSharing,
} from '../src/js/team-spaces.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

/** An ID token that ends in an hour (the signature is never checked by the page) */
const ID_TOKEN = (() => {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const exp = Math.floor(Date.now() / 1000) + 3600
  return `${encode({ alg: 'RS256' })}.${encode({ exp })}.signature`
})()

type Request = { method: string; path: string; headers: Headers; body?: unknown }

describe('team spaces on this device', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  let requests: Request[]
  /** What the Worker answers: by "METHOD /path" */
  let routes: Record<string, (request: Request) => Response>
  const made: string[] = []
  let before: { id: string | null; name: string }

  const json = (body: unknown, status = 200) => Response.json(body, { status })
  const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`

  /** A space on this device, deleted at the end of the test */
  async function space(name: string, updates: Partial<Space> = {}): Promise<Space> {
    const created = await createSpace(unique(name))
    made.push(created.id)
    return updates ? updateSpace(created.id, updates) : created
  }

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    worker.stored = {
      blob: 'the-blob',
      metadata: { id_token: ID_TOKEN, scope: 'openid email profile' },
      updated_at: new Date().toISOString(),
    }
    before = getCurrentSpace()
    requests = []
    routes = {}
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const request: Request = {
        method: init?.method ?? 'GET',
        path: url.pathname + url.search,
        headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      }
      requests.push(request)
      const route = routes[`${request.method} ${url.pathname}`]
      return route ? route(request) : json({ error: 'no such route' }, 404)
    }) as typeof fetch
  })

  afterEach(async () => {
    window.fetch = realFetch
    uninstallWorker()
    // (a space the test left or stopped sharing is gone already)
    for (const id of made.splice(0)) await deleteSpace(id).catch(() => {})
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  describe('the Worker’s routes', () => {
    it('are called with the Google ID token, and the answer is what they say', async () => {
      routes['POST /api/spaces'] = () => json({ spaceId: 'space-12345678', role: 'owner' })
      const answer = await teamApi.createSpace({ blob: 'b', rootRef: 'folder', name: 'Church' })
      expect(answer).to.deep.equal({ spaceId: 'space-12345678', role: 'owner' })
      expect(requests[0].headers.get('Authorization')).to.equal(`Bearer ${ID_TOKEN}`)
      expect(requests[0].headers.get('Content-Type')).to.equal('application/json')
      expect(requests[0].body).to.deep.equal({ blob: 'b', rootRef: 'folder', name: 'Church' })
    })

    it('send no body where there is none, and take no answer where there is none (204)', async () => {
      routes['POST /api/space/space-1/leave'] = () => new Response(null, { status: 204 })
      expect(await teamApi.leave('space-1')).to.equal(undefined)
      expect(requests[0].headers.get('Content-Type')).to.equal(null)
      expect(requests[0].body).to.equal(undefined)
    })

    it('keep an id or an email in the path whole', async () => {
      routes['DELETE /api/space/a%2Fb/members/ann%40example.com'] = () =>
        new Response(null, { status: 204 })
      await teamApi.removeMember('a/b', 'ann@example.com')
      expect(requests[0].path).to.equal('/api/space/a%2Fb/members/ann%40example.com')
    })

    it('say what the Worker said, with its status, or just the status', async () => {
      routes['POST /api/spaces/join'] = () => json({ error: 'This invite is not valid' }, 404)
      const refused = await teamApi.join('space-1', 'code').catch(error => error)
      expect(refused).to.be.instanceOf(TeamError)
      expect(refused.message).to.equal('This invite is not valid')
      expect(refused.status).to.equal(404)

      routes['GET /api/space/space-1/invites'] = () => new Response('oops', { status: 500 })
      const failed = await teamApi.invites('space-1').catch(error => error)
      expect(failed.message).to.equal('Error 500')
    })

    it('cover the rest of the routes', async () => {
      const ok = () => new Response(null, { status: 204 })
      routes['GET /api/space/s/members'] = () => json([{ email: 'a@example.com', role: 'owner' }])
      routes['POST /api/space/s/invites'] = () => json({ code: 'c', expiresAt: 'later' })
      routes['DELETE /api/space/s/invites/abc'] = ok
      routes['PUT /api/space/s/members/b%40example.com'] = ok
      routes['PUT /api/space/s/credential'] = ok
      routes['DELETE /api/space/s'] = ok

      expect(await teamApi.members('s')).to.deep.equal([{ email: 'a@example.com', role: 'owner' }])
      expect(await teamApi.createInvite('s', 'writer', 'b@example.com')).to.deep.equal({
        code: 'c',
        expiresAt: 'later',
      })
      await teamApi.revokeInvite('s', 'abc')
      await teamApi.setRole('s', 'b@example.com', 'reader')
      await teamApi.replaceCredential('s', 'new-blob')
      await teamApi.endSharing('s')
      expect(requests.map(request => `${request.method} ${request.path}`)).to.deep.equal([
        'GET /api/space/s/members',
        'POST /api/space/s/invites',
        'DELETE /api/space/s/invites/abc',
        'PUT /api/space/s/members/b%40example.com',
        'PUT /api/space/s/credential',
        'DELETE /api/space/s',
      ])
      expect(requests[1].body).to.deep.equal({ role: 'writer', email: 'b@example.com' })
    })
  })

  describe('which backend a space uses', () => {
    it('is Drive for a space of one’s own, and for the owner of a team space', () => {
      expect(storageFor(undefined)).to.equal(driveStorage)
      expect(storageFor({})).to.equal(driveStorage)
      expect(storageFor({ team: { id: 't', role: 'owner' } })).to.equal(driveStorage)
      expect(isTeamMember({ team: { id: 't', role: 'owner' } })).to.equal(false)
    })

    it('is Drive when there is no space to ask about', async () => {
      expect(await getSpaceById(null)).to.equal(undefined)
      expect(await getSpaceById('no-such-space')).to.equal(undefined)
    })

    it('is the Worker for anyone else in a team space', () => {
      for (const role of ['admin', 'writer', 'reader'] as const) {
        const backend = storageFor({ team: { id: 't', role } })
        expect(backend).to.be.instanceOf(TeamStorage)
        expect(isTeamMember({ team: { id: 't', role } })).to.equal(true)
      }
    })

    it('reaches the Worker with the ID token, using the page’s fetch of the moment', async () => {
      routes['GET /api/space/t/root'] = () =>
        json({ ref: 't', name: 'Church', trashed: false, canWrite: true })
      const root = await storageFor({ team: { id: 't', role: 'writer' } }).inspectRoot('t')
      expect(root?.name).to.equal('Church')
      expect(requests[0].headers.get('Authorization')).to.equal(`Bearer ${ID_TOKEN}`)
    })

    it('is what sync is created with, and what says it is available, for a member', async () => {
      const mine = await space('Joined', {
        rootRef: 'team-1',
        team: { id: 'team-1', role: 'writer' },
      })
      await setCurrentSpace(mine.id, mine.name)
      routes['GET /api/space/team-1/root'] = () =>
        json({ ref: 'team-1', name: mine.name, trashed: false, canWrite: true })

      expect(await isSyncAvailable()).to.equal(true)
      const manager = await createSyncManager(mine.name, mine.id)
      expect(manager.storage).to.be.instanceOf(TeamStorage)
      expect(manager.rootRef).to.equal('team-1')
      manager.spaceDb?.db?.close()

      // (with no space named, it is the current one's)
      const current = await createSyncManager(mine.name, null)
      expect(current.storage).to.be.instanceOf(TeamStorage)
      current.spaceDb?.db?.close()
    })
  })

  describe('creating a team space', () => {
    const folders = () => {
      const made: [string, string][] = []
      return {
        made,
        createTeamFolder: async (parentId: string, name: string) => {
          made.push([parentId, name])
          return 'new-folder'
        },
      }
    }

    it('makes a folder in the picked parent, registers it, and keeps a space of its own for it', async () => {
      routes['POST /api/spaces'] = () => json({ spaceId: 'space-bbbb2222', role: 'owner' })
      const drive = folders()
      const name = unique('St Mary’s')

      const created = await createTeamSpace(`  ${name} `, 'picked-parent', drive)
      made.push(created.id)
      expect(drive.made).to.deep.equal([['picked-parent', name]])
      expect(requests[0].body).to.deep.equal({ blob: 'the-blob', rootRef: 'new-folder', name })
      expect(created.name).to.equal(name)
      expect(created.rootRef).to.equal('new-folder')
      expect(created.team).to.deep.equal({ id: 'space-bbbb2222', role: 'owner' })
    })

    it('does not touch the personal space, and renames only if the name is taken here', async () => {
      routes['POST /api/spaces'] = () => json({ spaceId: 'space-cccc3333', role: 'owner' })
      const mine = await space('Church')
      const created = await createTeamSpace(mine.name, 'p', folders())
      made.push(created.id)
      expect(created.id).to.not.equal(mine.id)
      expect(created.name).to.equal(`${mine.name} (team)`)
      expect((await getSpaceById(mine.id))?.team).to.equal(undefined)
    })

    it('leaves no space here when the Worker refuses, and asks for a name and a sign-in', async () => {
      const message = (work: Promise<unknown>) =>
        work.then(
          () => '',
          error => (error as Error).message
        )
      routes['POST /api/spaces'] = () => json({ error: 'No' }, 403)
      const before = (await listSpaces()).length
      expect(await message(createTeamSpace(unique('Refused'), 'p', folders()))).to.equal('No')
      expect((await listSpaces()).length).to.equal(before)

      expect(await message(createTeamSpace('  ', 'p', folders()))).to.match(/needs a name/)
      worker.stored = undefined
      expect(await message(createTeamSpace('Church', 'p', folders()))).to.match(/Sign in/)
    })
  })

  describe('joining a space', () => {
    const backend = (name: string | null) => ({
      inspectRoot: async () => (name ? { ref: 't', name, trashed: false, canWrite: true } : null),
    })

    it('makes a space of the team’s name, whose root is the team space, and no longer read-only for a writer', async () => {
      routes['POST /api/spaces/join'] = () => json({ spaceId: 'space-bbbb2222', role: 'writer' })
      const name = unique('Pat Church')
      const joined = await joinSpace('space-bbbb2222', 'the-code', backend(name))
      made.push(joined.id)

      expect(requests[0].body).to.deep.equal({ spaceId: 'space-bbbb2222', code: 'the-code' })
      expect(joined.name).to.equal(name)
      expect(joined.rootRef).to.equal('space-bbbb2222')
      expect(joined.team).to.deep.equal({ id: 'space-bbbb2222', role: 'writer' })
      expect(joined.readOnly).to.equal(false)
    })

    it('makes a reader’s space read-only', async () => {
      routes['POST /api/spaces/join'] = () => json({ spaceId: 'space-cccc3333', role: 'reader' })
      const joined = await joinSpace('space-cccc3333', 'c', backend(unique('Readers')))
      made.push(joined.id)
      expect(joined.readOnly).to.equal(true)
    })

    it('does not take the name of a space already here', async () => {
      routes['POST /api/spaces/join'] = () => json({ spaceId: 'space-dddd4444', role: 'writer' })
      const taken = await space('Same Name')
      const first = await joinSpace('space-dddd4444', 'c', backend(taken.name))
      const second = await joinSpace('space-dddd4444', 'c', backend(taken.name))
      made.push(first.id, second.id)
      expect(first.name).to.equal(`${taken.name} (team)`)
      expect(second.name).to.equal(`${taken.name} (team 2)`)
    })

    it('is a space called Team if the Worker cannot yet say what it is called', async () => {
      routes['POST /api/spaces/join'] = () => json({ spaceId: 'space-eeee5555', role: 'writer' })
      for (const root of [
        backend(null),
        { inspectRoot: async () => Promise.reject(new Error('409')) },
      ]) {
        const joined = await joinSpace('space-eeee5555', 'c', root)
        made.push(joined.id)
        expect(joined.name).to.match(/^Team/)
      }
      expect(
        (await listSpaces()).filter(each => each.name.startsWith('Team')).length
      ).to.be.at.least(2)
    })

    it('makes nothing when the invite is not good', async () => {
      routes['POST /api/spaces/join'] = () => json({ error: 'This invite is not valid' }, 404)
      const count = (await listSpaces()).length
      const refused = await joinSpace('space-ffff6666', 'c', backend('x')).catch(error => error)
      expect(refused).to.be.instanceOf(TeamError)
      expect((await listSpaces()).length).to.equal(count)
      must(refused)
    })
  })

  describe('who acts on whom', () => {
    it('is only on those below: an admin on writers and readers, the owner on everyone else', () => {
      expect(outranks('owner', 'admin')).to.equal(true)
      expect(outranks('admin', 'writer')).to.equal(true)
      expect(outranks('admin', 'admin')).to.equal(false)
      expect(outranks('admin', 'owner')).to.equal(false)
      expect(outranks('reader', 'reader')).to.equal(false)
    })

    it('has the invite link hold the space and the code in the fragment', () => {
      expect(inviteLink('https://chordless.app', 'space-1', 'code')).to.equal(
        'https://chordless.app/join#space-1.code'
      )
    })
  })

  describe('stopping sharing, and leaving', () => {
    const message = (work: Promise<unknown>) =>
      work.then(
        () => '',
        error => (error as Error).message
      )

    it('stop sharing tells the Worker, and the space is the owner’s alone again', async () => {
      routes['DELETE /api/space/team-1'] = () => new Response(null, { status: 204 })
      const mine = await space('Shared', { rootRef: 'f', team: { id: 'team-1', role: 'owner' } })
      const stopped = await stopSharing(mine.id)
      expect(stopped.team).to.equal(undefined)
      expect(stopped.rootRef).to.equal('f')
      expect((await getSpaceById(mine.id))?.team).to.equal(undefined)
    })

    it('leaving tells the Worker, and the copy on this device goes', async () => {
      routes['POST /api/space/team-1/leave'] = () => new Response(null, { status: 204 })
      const joined = await space('Joined', {
        rootRef: 'team-1',
        team: { id: 'team-1', role: 'reader' },
      })
      await leaveSpace(joined.id)
      expect(await getSpaceById(joined.id)).to.equal(undefined)
    })

    it('leaving keeps the copy when the Worker refuses', async () => {
      routes['POST /api/space/team-1/leave'] = () => json({ error: 'The owner cannot leave' }, 400)
      const joined = await space('Kept', {
        rootRef: 'team-1',
        team: { id: 'team-1', role: 'writer' },
      })
      expect(await message(leaveSpace(joined.id))).to.equal('The owner cannot leave')
      expect(await getSpaceById(joined.id)).to.not.equal(undefined)
    })

    it('say so for a space that is not shared', async () => {
      const mine = await space('Plain')
      expect(await message(stopSharing(mine.id))).to.match(/not shared/)
      expect(await message(leaveSpace(mine.id))).to.match(/not shared/)
      expect(await message(stopSharing('nothing'))).to.match(/not shared/)
      expect(requests).to.have.length(0)
    })
  })
})
