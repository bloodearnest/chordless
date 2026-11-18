/**
 * Who the person is in a Team, and the way out of it (team-membership-panel.ts): the owner stops sharing, any other
 * member leaves, each after a question, and what is said when the Worker refuses. The Worker is a fetch that answers
 * from a table, and the service worker that keeps the sign-in a fake one.
 */
import { expect, waitUntil } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import '../src/components/team-membership-panel.ts'
import {
  TeamLeftEvent,
  type TeamMembershipPanel,
  TeamSharingStoppedEvent,
} from '../src/components/team-membership-panel.ts'
import type { Space } from '../src/js/data-types.ts'
import { createSpace, deleteSpace, getSpaceById, updateSpace } from '../src/js/space.ts'
import type { TeamRole } from '../src/js/team-roles.ts'
import { type FakeAuthWorker, installFakeAuthWorker, sessionFor } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { nothingFor, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const ID_TOKEN = `${encode({ alg: 'RS256' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`

const TEAM = 'space-aaaa1111'

describe('the team membership panel', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  let calls: { key: string }[]
  let routes: Record<string, () => Response>
  let panel: TeamMembershipPanel
  const made: string[] = []
  let stopped: number
  let left: number

  const json = (body: unknown, status = 200) => Response.json(body, { status })
  const done = () => new Response(null, { status: 204 })
  const text = () => (panel.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  const button = (label: string) =>
    must(
      Array.from(panel.shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(each =>
        each.textContent?.includes(label)
      )
    )
  async function until(condition: () => unknown, what: string) {
    await waitUntil(() => condition(), undefined, { timeout: 2000 })
    expect(condition(), what).to.be.ok
  }
  /** Answer the question the panel asks */
  async function answer(confirm: boolean) {
    const modal = must(panel.shadowRoot?.querySelector<AppModal>('app-modal'))
    await until(() => modal.open, 'the question to be asked')
    await modal.updateComplete
    must(
      modal.shadowRoot?.querySelector<HTMLElement>(
        confirm ? '.modal-btn-confirm' : '.modal-btn-cancel'
      )
    ).click()
    return modal
  }

  /** A space on this device (deleted at the end), shared as this role, or not shared */
  async function space(role: TeamRole | null, updates: Partial<Space> = {}): Promise<Space> {
    const created = await createSpace(`Panel ${crypto.randomUUID().slice(0, 8)}`)
    made.push(created.id)
    return updateSpace(created.id, {
      ...(role ? { rootRef: role === 'owner' ? 'folder-1' : TEAM, team: { id: TEAM, role } } : {}),
      ...updates,
    })
  }

  async function open(shared: Space) {
    panel = document.createElement('team-membership-panel')
    panel.space = shared
    panel.addEventListener(TeamSharingStoppedEvent.type, () => stopped++)
    panel.addEventListener(TeamLeftEvent.type, () => left++)
    document.body.append(panel)
    await panel.updateComplete
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
    calls = []
    stopped = 0
    left = 0
    routes = {}
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      const key = `${init?.method ?? 'GET'} ${path}`
      calls.push({ key })
      const route = routes[key]
      return route ? route() : json({ error: `no route ${key}` }, 404)
    }) as typeof fetch
  })

  afterEach(async () => {
    panel?.remove()
    window.fetch = realFetch
    uninstallWorker()
    for (const id of made.splice(0)) await deleteSpace(id).catch(() => {})
  })

  it('shows nothing for a space that is not a Team’s, and asks the Worker nothing', async () => {
    await open(await space(null, { rootRef: 'folder-1' }))
    expect(panel.shadowRoot?.textContent?.trim()).to.equal('')
    expect(calls).to.deep.equal([])
  })

  it('shows nothing without a space', async () => {
    panel = document.createElement('team-membership-panel')
    document.body.append(panel)
    await panel.updateComplete
    expect(panel.shadowRoot?.textContent?.trim()).to.equal('')
  })

  describe('as the owner', () => {
    it('says so, and offers to stop sharing, not to leave', async () => {
      await open(await space('owner'))
      expect(text()).to.contain('Your place in the Team')
      expect(text()).to.contain('You are the owner of this Team')
      expect(text()).to.contain('Stop sharing')
      expect(text()).to.not.contain('Leave this Team')
    })

    it('stops sharing when sure: the Worker forgets it, and the space is its owner’s alone again', async () => {
      routes[`DELETE /api/space/${TEAM}`] = () => done()
      const shared = await space('owner')
      await open(shared)
      button('Stop sharing').click()
      await answer(true)
      await until(() => stopped === 1, 'sharing to stop')
      expect(calls.some(call => call.key === `DELETE /api/space/${TEAM}`)).to.equal(true)
      expect((await getSpaceById(shared.id))?.team).to.equal(undefined)
    })

    it('does not stop sharing when not sure', async () => {
      await open(await space('owner'))
      button('Stop sharing').click()
      await answer(false)
      await nothingFor(50)
      expect(stopped).to.equal(0)
      expect(calls).to.deep.equal([])
    })

    it('says what the Worker said when it refuses', async () => {
      routes[`DELETE /api/space/${TEAM}`] = () => json({ error: 'Not now' }, 403)
      await open(await space('owner'))
      button('Stop sharing').click()
      await answer(true)
      await until(() => text().includes('Not now'), 'the message')
      expect(stopped).to.equal(0)
    })
  })

  describe('as a writer or a reader', () => {
    it('says what they are, and offers to leave, not to stop sharing', async () => {
      await open(await space('writer'))
      expect(text()).to.contain('You are a worship leader in this Team')
      expect(text()).to.contain('Leave this Team')
      expect(text()).to.not.contain('Stop sharing')
    })

    it('leaves when sure: the Worker is told, the space goes from this device, and the app is told to start afresh', async () => {
      routes[`POST /api/space/${TEAM}/leave`] = () => done()
      const shared = await space('reader')
      await open(shared)
      button('Leave this Team').click()
      await answer(true)
      await until(() => left === 1, 'the person to leave')
      expect(calls.some(call => call.key === `POST /api/space/${TEAM}/leave`)).to.equal(true)
      expect(await getSpaceById(shared.id)).to.equal(undefined)
    })

    it('stays when not sure', async () => {
      const shared = await space('reader')
      await open(shared)
      button('Leave this Team').click()
      await answer(false)
      await nothingFor(50)
      expect(left).to.equal(0)
      expect(calls).to.deep.equal([])
      expect(await getSpaceById(shared.id)).to.not.equal(undefined)
    })
  })
})
