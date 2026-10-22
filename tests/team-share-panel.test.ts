/**
 * The panel that shares the current space with a team and looks after it (team-share-panel.ts):
 * what each role sees and may do, the confirmations, the invite link, and what is said when the
 * Worker refuses. The Worker is a fetch that answers from a table, and the service worker that
 * keeps the sign-in a fake one.
 */
import { expect } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import '../src/components/team-share-panel.ts'
import {
  TeamShareChangedEvent,
  TeamShareLeftEvent,
  type TeamSharePanel,
} from '../src/components/team-share-panel.ts'
import type { Space, TeamRole } from '../src/js/data-types.ts'
import { createSpace, deleteSpace, getSpaceById, updateSpace } from '../src/js/space.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const ID_TOKEN = `${encode({ alg: 'RS256' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`

const TEAM = 'space-aaaa1111'
const people = [
  { email: 'ann@example.com', role: 'owner' },
  { email: 'dan@example.com', role: 'admin' },
  { email: 'bob@example.com', role: 'writer' },
  { email: 'cat@example.com', role: 'reader' },
]
const waiting = [
  {
    id: 'ab12',
    email: 'eve@example.com',
    role: 'reader',
    createdBy: 'ann@example.com',
    createdAt: '2026-10-21T00:00:00Z',
    expiresAt: '2026-10-28T00:00:00Z',
  },
]

describe('the team share panel', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  let calls: { key: string; body?: unknown }[]
  let routes: Record<string, (body?: unknown) => Response>
  let panel: TeamSharePanel
  const made: string[] = []
  let changed: number
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
    for (let i = 0; i < 100 && !condition(); i++) await wait(20)
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
    panel = document.createElement('team-share-panel')
    panel.space = shared
    panel.addEventListener(TeamShareChangedEvent.type, () => changed++)
    panel.addEventListener(TeamShareLeftEvent.type, () => left++)
    document.body.append(panel)
    await panel.updateComplete
  }

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    worker.stored = {
      blob: 'the-blob',
      metadata: { id_token: ID_TOKEN, scope: 'openid email profile' },
      updated_at: new Date().toISOString(),
    }
    calls = []
    changed = 0
    left = 0
    routes = {
      [`GET /api/space/${TEAM}/members`]: () => json(people),
      [`GET /api/space/${TEAM}/invites`]: () => json(waiting),
    }
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      const key = `${init?.method ?? 'GET'} ${path}`
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ key, body })
      const route = routes[key]
      return route ? route(body) : json({ error: `no route ${key}` }, 404)
    }) as typeof fetch
  })

  afterEach(async () => {
    panel?.remove()
    window.fetch = realFetch
    uninstallWorker()
    for (const id of made.splice(0)) await deleteSpace(id).catch(() => {})
  })

  describe('a space that is not shared', () => {
    it('shows nothing for a space that is not a Team’s, and asks the Worker nothing', async () => {
      await open(await space(null, { rootRef: 'folder-1' }))
      expect(panel.shadowRoot?.textContent?.trim()).to.equal('')
      expect(calls).to.deep.equal([])
    })
  })

  describe('as the owner', () => {
    it('sees everyone, may change and remove all but the owner, and see who is invited', async () => {
      await open(await space('owner'))
      await until(() => text().includes('cat@example.com'), 'the people')
      expect(text()).to.contain('the owner of this Team')
      const selects = panel.shadowRoot?.querySelectorAll('ul.people select') ?? []
      expect(selects).to.have.length(3) // dan, bob, cat: not ann
      expect(text()).to.contain('eve@example.com')
      expect(text()).to.contain('Withdraw')
      expect(panel.shadowRoot?.querySelector('.role')?.textContent).to.equal('owner')
    })

    it('says what the Worker said when a change is refused', async () => {
      routes[`PUT /api/space/${TEAM}/members/cat%40example.com`] = () =>
        json({ error: 'You cannot do that' }, 403)
      await open(await space('owner'))
      await until(() => text().includes('cat@example.com'), 'the people')
      const select = must(
        panel.shadowRoot?.querySelector<HTMLSelectElement>(
          'select[aria-label="Role of cat@example.com"]'
        )
      )
      select.value = 'writer'
      select.dispatchEvent(new Event('change'))
      await until(() => text().includes('You cannot do that'), 'the refusal')
    })

    it('changes a role, and reads the people again', async () => {
      routes[`PUT /api/space/${TEAM}/members/cat%40example.com`] = () => done()
      await open(await space('owner'))
      await until(() => text().includes('cat@example.com'), 'the people')
      const select = must(
        panel.shadowRoot?.querySelector<HTMLSelectElement>(
          'select[aria-label="Role of cat@example.com"]'
        )
      )
      select.value = 'writer'
      select.dispatchEvent(new Event('change'))
      await until(() => calls.some(call => call.key.startsWith('PUT')), 'the role to be set')
      expect(calls.find(call => call.key.startsWith('PUT'))?.body).to.deep.equal({ role: 'writer' })
      expect(
        calls.filter(call => call.key.endsWith('/members') && call.key.startsWith('GET'))
      ).to.have.length(2)
    })

    it('removes someone when sure, and not when not', async () => {
      routes[`DELETE /api/space/${TEAM}/members/bob%40example.com`] = () => done()
      await open(await space('owner'))
      await until(() => text().includes('bob@example.com'), 'the people')
      const remove = () =>
        Array.from(
          panel.shadowRoot?.querySelectorAll<HTMLButtonElement>('ul.people button') ?? []
        )[1]

      remove().click()
      await answer(false)
      await wait(50)
      expect(calls.some(call => call.key.startsWith('DELETE'))).to.equal(false)

      remove().click()
      const modal = await answer(true)
      expect(modal.heading).to.contain('bob@example.com')
      await until(() => calls.some(call => call.key.startsWith('DELETE')), 'the removal')
    })

    it('makes an invite for an email, shows its link once, and lists it as waiting', async () => {
      routes[`POST /api/space/${TEAM}/invites`] = () =>
        json({ code: 'CODE1234567890ab', expiresAt: 'later' })
      await open(await space('owner'))
      await until(() => text().includes('Invite someone'), 'the form')
      const email = must(panel.shadowRoot?.querySelector<HTMLInputElement>('input[type="email"]'))
      email.value = '  Fay@Example.com '
      must(
        panel.shadowRoot?.querySelector<HTMLSelectElement>('select[aria-label="Their role"]')
      ).value = 'reader'
      button('Make the invite').click()
      await until(() => panel.shadowRoot?.querySelector('.link-box'), 'the link')

      expect(calls.find(call => call.key.startsWith('POST'))?.body).to.deep.equal({
        role: 'reader',
        email: 'Fay@Example.com',
      })
      expect(text()).to.contain('Link for fay@example.com')
      expect(must(panel.shadowRoot?.querySelector<HTMLInputElement>('input.link')).value).to.equal(
        `${window.location.origin}/join#${TEAM}.CODE1234567890ab`
      )
      expect(email.value).to.equal('')
    })

    it('copies the link, or selects it when it cannot', async () => {
      routes[`POST /api/space/${TEAM}/invites`] = () =>
        json({ code: 'CODE1234567890ab', expiresAt: 'later' })
      await open(await space('owner'))
      await until(() => text().includes('Invite someone'), 'the form')
      must(panel.shadowRoot?.querySelector<HTMLInputElement>('input[type="email"]')).value =
        'fay@example.com'
      button('Make the invite').click()
      await until(() => panel.shadowRoot?.querySelector('.link-box'), 'the link')

      const copied: string[] = []
      const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (value: string) => void copied.push(value) },
      })
      try {
        button('Copy the link').click()
        await until(() => text().includes('✓ Copied'), 'the copy')
        expect(copied[0]).to.contain(`/join#${TEAM}.`)

        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async () => Promise.reject(new Error('denied')) },
        })
        button('Copied').click()
        await wait(50)
        expect(text()).to.contain('Copied')
      } finally {
        if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
        else Reflect.deleteProperty(navigator, 'clipboard')
      }
    })

    it('withdraws an invite', async () => {
      routes[`DELETE /api/space/${TEAM}/invites/ab12`] = () => done()
      await open(await space('owner'))
      await until(() => text().includes('Withdraw'), 'the invites')
      button('Withdraw').click()
      await until(() => calls.some(call => call.key.startsWith('DELETE')), 'the withdrawal')
    })

    it('stops sharing when sure: the Worker forgets it, and the space is its owner’s alone again', async () => {
      routes[`DELETE /api/space/${TEAM}`] = () => done()
      const mine = await space('owner')
      await open(mine)
      button('Stop sharing').click()
      await answer(true)
      await until(() => changed === 1, 'sharing to stop')
      expect((await getSpaceById(mine.id))?.team).to.equal(undefined)
    })

    it('does not stop sharing when not sure', async () => {
      const mine = await space('owner')
      await open(mine)
      button('Stop sharing').click()
      await answer(false)
      await wait(50)
      expect(changed).to.equal(0)
      expect((await getSpaceById(mine.id))?.team?.id).to.equal(TEAM)
    })
  })

  describe('as an admin', () => {
    it('manages writers and readers, and can invite up to writer, but not touch the other admin or the owner', async () => {
      await open(await space('admin'))
      await until(() => text().includes('cat@example.com'), 'the people')
      expect(text()).to.contain('an admin in this Team')
      const selects = panel.shadowRoot?.querySelectorAll('ul.people select') ?? []
      expect(selects).to.have.length(2) // bob, cat: not ann, not dan
      const roles = Array.from(
        must(panel.shadowRoot?.querySelector<HTMLSelectElement>('select[aria-label="Their role"]'))
          .options
      ).map(option => option.value)
      expect(roles).to.deep.equal(['reader', 'writer'])
      expect(button('Leave this Team').disabled).to.equal(false)
      expect(text()).to.not.contain('Stop sharing')
    })
  })

  describe('as a writer or a reader', () => {
    for (const role of ['writer', 'reader'] as const) {
      it(`as a ${role}: sees who is in the space, can change nothing, and can leave`, async () => {
        await open(await space(role))
        await until(() => text().includes('cat@example.com'), 'the people')
        expect(panel.shadowRoot?.querySelector('ul.people select') === null).to.equal(true)
        expect(text()).to.not.contain('Invite someone')
        expect(calls.some(call => call.key.endsWith('/invites'))).to.equal(false)
        expect(button('Leave this Team').disabled).to.equal(false)
      })
    }

    it('leaves when sure: the Worker is told, the space goes from this device, and the app is told to start afresh', async () => {
      routes[`POST /api/space/${TEAM}/leave`] = () => done()
      const mine = await space('writer')
      await open(mine)
      await until(() => text().includes('cat@example.com'), 'the people')
      button('Leave this Team').click()
      await answer(true)
      await until(() => left === 1, 'to leave')
      expect(await getSpaceById(mine.id)).to.equal(undefined)
    })

    it('stays when not sure', async () => {
      const mine = await space('reader')
      await open(mine)
      await until(() => text().includes('cat@example.com'), 'the people')
      button('Leave this Team').click()
      await answer(false)
      await wait(50)
      expect(left).to.equal(0)
      expect(await getSpaceById(mine.id)).to.not.equal(undefined)
    })
  })

  it('says why the people could not be read, with nothing else to show', async () => {
    routes[`GET /api/space/${TEAM}/members`] = () =>
      json({ error: 'Sharing is not set up for this space' }, 409)
    await open(await space('owner'))
    await until(() => text().includes('Sharing is not set up'), 'the reason')
  })

  it('shows nothing without a space, and starts over for a different team space', async () => {
    panel = document.createElement('team-share-panel')
    document.body.append(panel)
    await panel.updateComplete
    expect(panel.shadowRoot?.querySelector('.panel') === null).to.equal(true)

    panel.space = await space('owner')
    await until(() => text().includes('cat@example.com'), 'the people')
    panel.space = await space(null)
    await panel.updateComplete
    expect(text()).to.not.contain('cat@example.com')
  })
})
