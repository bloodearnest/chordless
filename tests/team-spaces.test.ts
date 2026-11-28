/**
 * Team spaces on this device: the Worker's routes as the page calls them (team-client.ts), which
 * backend a space is reached through (space-storage.ts), and sharing and joining (team-spaces.ts).
 * The Worker is a fetch that answers from a table, and the service worker that keeps the sign-in
 * a fake one (fake-auth-worker.ts).
 */
import { expect } from '@open-wc/testing'
import { cleanLicence } from '../src/js/ccli-licence.ts'
import type { Space } from '../src/js/data-types.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  getSpaceById,
  setCurrentSpace,
  updateSpace,
} from '../src/js/space.ts'
import { isTeamMember } from '../src/js/storage/space-storage.ts'
import { teamApi } from '../src/js/team-client.ts'
import { outranks } from '../src/js/team-roles.ts'
import { inviteLink, learnOfMove } from '../src/js/team-spaces.ts'
import { TeamError } from '../src/js/worker-call.ts'
import { type FakeAuthWorker, installFakeAuthWorker, sessionFor } from './fake-auth-worker.ts'
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
      metadata: {
        id_token: ID_TOKEN,
        session: sessionFor(ID_TOKEN),
        scope: 'openid email profile',
      },
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
    it('reads the Team metadata storage mode from its root', async () => {
      const root = { ref: 'team', name: 'Church', trashed: false, canWrite: true, storage: 'd1' }
      routes['GET /api/space/team/root'] = () => json(root)
      expect(await teamApi.root('team')).to.deep.equal(root)
    })

    it('are called with the Google ID token, and the answer is what they say', async () => {
      routes['POST /api/spaces'] = () => json({ spaceId: 'space-12345678', role: 'owner' })
      const answer = await teamApi.createSpace({ rootRef: 'folder', name: 'Church' })
      expect(answer).to.deep.equal({ spaceId: 'space-12345678', role: 'owner' })
      expect(requests[0].headers.get('Authorization')).to.equal(`Bearer ${ID_TOKEN}`)
      expect(requests[0].headers.get('Content-Type')).to.equal('application/json')
      expect(requests[0].body).to.deep.equal({ rootRef: 'folder', name: 'Church' })
    })

    it('send no body where there is none, and take no answer where there is none (204)', async () => {
      routes['POST /api/space/space-1/leave'] = () => new Response(null, { status: 204 })
      expect(await teamApi.leave('space-1')).to.equal(undefined)
      expect(requests[0].headers.get('Content-Type')).to.equal(null)
      expect(requests[0].body).to.equal(undefined)
    })

    it('look an invite up with no sign-in, and say not valid for a code that is no good, and fail for anything else', async () => {
      routes['POST /api/spaces/invite'] = () =>
        json({ teamName: 'Church', role: 'reader', email: 'bea@example.com', google: 'other' })
      expect(await teamApi.lookupInvite('space-1', 'code')).to.deep.equal({
        teamName: 'Church',
        role: 'reader',
        email: 'bea@example.com',
        google: 'other',
      })
      expect(requests[0].headers.get('Authorization')).to.equal(null)
      expect(requests[0].body).to.deep.equal({ spaceId: 'space-1', code: 'code' })

      routes['POST /api/spaces/invite'] = () => json({ error: 'This invite is not valid' }, 404)
      expect(await teamApi.lookupInvite('space-1', 'code')).to.equal(null)

      routes['POST /api/spaces/invite'] = () => json({ error: 'Too many tries' }, 429)
      let failure: unknown
      try {
        await teamApi.lookupInvite('space-1', 'code')
      } catch (error) {
        failure = error
      }
      expect(failure).to.be.instanceOf(TeamError)
      expect((failure as TeamError).status).to.equal(429)
    })

    it('keep an id or an email in the path whole', async () => {
      routes['DELETE /api/space/a%2Fb/members/ann%40example.com'] = () =>
        new Response(null, { status: 204 })
      await teamApi.removeMember('a/b', 'ann@example.com')
      expect(requests[0].path).to.equal('/api/space/a%2Fb/members/ann%40example.com')
    })

    it('ask for a Team to be deleted everywhere with a DELETE of its everything', async () => {
      routes['DELETE /api/space/space-1/everything'] = () => new Response(null, { status: 204 })
      expect(await teamApi.deleteEverything('space-1')).to.equal(undefined)
      expect(requests[0].method).to.equal('DELETE')
      expect(requests[0].path).to.equal('/api/space/space-1/everything')
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
      await teamApi.replaceCredential('s')
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

  describe('a team that moved into its church while the device was away', () => {
    const moved = new TeamError(
      'This team has moved to its church on Chordless: update the app to carry on',
      410
    )

    it('is learned of when the Worker says so, and the space is then the church’s', async () => {
      const drive = await space('Moving', { team: { id: 'space-mmmm1111', role: 'writer' } })
      let asked = 0
      const church = await learnOfMove(drive, moved, async () => {
        asked++
        await updateSpace(drive.id, {
          team: { id: 'space-mmmm1111', role: 'writer', churchId: 'c' },
        })
      })
      expect(asked).to.equal(1)
      expect(church?.team?.churchId).to.equal('c')
    })

    it('is not taken for another failure, and is left as it was if the check did not make it the church’s', async () => {
      const drive = await space('Staying', { team: { id: 'space-mmmm2222', role: 'writer' } })
      let asked = 0
      const check = async () => void asked++
      expect(await learnOfMove(drive, new Error('offline'), check)).to.equal(null)
      expect(await learnOfMove(drive, 'a string', check)).to.equal(null)
      expect(asked).to.equal(0)
      expect(await learnOfMove(drive, moved, check)).to.equal(null)
      expect(asked).to.equal(1)
    })
  })

  describe('a team’s member', () => {
    it('is anyone in a team but its owner', () => {
      expect(isTeamMember(undefined)).to.equal(false)
      expect(isTeamMember({})).to.equal(false)
      expect(isTeamMember({ team: { id: 't', role: 'owner' } })).to.equal(false)
      for (const role of ['admin', 'writer', 'reader'] as const) {
        expect(isTeamMember({ team: { id: 't', role } })).to.equal(true)
      }
    })

    it('has no space to ask about when there is none', async () => {
      expect(await getSpaceById(null)).to.equal(undefined)
      expect(await getSpaceById('no-such-space')).to.equal(undefined)
    })
  })

  it('tidies a licence number without judging it', () => {
    expect(cleanLicence(undefined)).to.equal('')
    expect(cleanLicence('#2345678')).to.equal('2345678')
    expect(cleanLicence('CCLI 98 76 54')).to.equal('987654')
    expect(cleanLicence('AB-12')).to.equal('AB-12')
  })

  describe('who acts on whom', () => {
    it('is only on those below: an admin on writers and readers, the owner on everyone else', () => {
      expect(outranks('owner', 'admin')).to.equal(true)
      expect(outranks('admin', 'writer')).to.equal(true)
      expect(outranks('admin', 'admin')).to.equal(false)
      expect(outranks('admin', 'owner')).to.equal(false)
      expect(outranks('reader', 'reader')).to.equal(false)
    })

    it('has the invite link hold the space and the code in the path', () => {
      expect(inviteLink('https://chordless.app', 'space-1', 'code')).to.equal(
        'https://chordless.app/join/space-1/code'
      )
    })
  })
})
