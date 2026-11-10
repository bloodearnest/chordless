/**
 * Team-managed storage for a Team's owner (team-storage-panel.ts): what is shown for each way the
 * Worker reaches the folder, the switch to Chordless's account and back, and what is said when the
 * Worker refuses. The Worker is a fetch that answers from a table, and the service worker that
 * keeps the sign-in a fake one.
 */
import { expect, waitUntil } from '@open-wc/testing'
import '../src/components/team-storage-panel.ts'
import type { TeamStoragePanel } from '../src/components/team-storage-panel.ts'
import type { Space } from '../src/js/data-types.ts'
import type { TeamRole } from '../src/js/team-roles.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { A11Y, nothingFor, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const ID_TOKEN = `${encode({ alg: 'RS256' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`

const TEAM = 'space-aaaa1111'
const ADDRESS = 'team-storage@chordless-app.iam.gserviceaccount.com'
const CREDENTIAL = `/api/space/${TEAM}/credential`

describe('the team storage panel', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  let calls: { key: string; body?: unknown }[]
  let routes: Record<string, (body?: unknown) => Response>
  let panel: TeamStoragePanel

  const json = (body: unknown, status = 200) => Response.json(body, { status })
  const text = () => (panel.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  const button = (label: string) =>
    must(
      Array.from(panel.shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(each =>
        each.textContent?.includes(label)
      )
    )
  const until = (condition: () => unknown, what: string) =>
    waitUntil(() => condition(), what, { timeout: 2000 })

  /** A Team on this device, as this role (not stored: the panel reads only what it is given) */
  const teamSpace = (role: TeamRole | null): Space => ({
    id: `local-${crypto.randomUUID()}`,
    name: 'St Mark’s',
    createdDate: '',
    modifiedDate: '',
    rootRef: 'folder-1',
    ...(role ? { team: { id: TEAM, role } } : {}),
  })

  async function open(space: Space) {
    panel = document.createElement('team-storage-panel')
    panel.space = space
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
    routes = {
      [`GET ${CREDENTIAL}`]: () => json({ kind: 'owner', serviceAccount: ADDRESS }),
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

  afterEach(() => {
    panel?.remove()
    window.fetch = realFetch
    uninstallWorker()
  })

  it('shows nothing, and asks nothing, to anyone but the owner', async () => {
    for (const role of [null, 'admin', 'writer', 'reader'] as const) {
      await open(teamSpace(role))
      await nothingFor()
      expect(panel.shadowRoot?.textContent?.trim()).to.equal('')
      panel.remove()
    }
    expect(calls).to.deep.equal([])
  })

  it('shows nothing where the server has no team storage', async () => {
    routes[`GET ${CREDENTIAL}`] = () => json({ kind: 'owner', serviceAccount: null })
    await open(teamSpace('owner'))
    await until(() => calls.length === 1, 'the question')
    await nothingFor()
    expect(panel.shadowRoot?.textContent?.trim()).to.equal('')
  })

  it('tells the owner what to add to the shared drive, and switches once the Worker has checked it', async () => {
    routes[`POST ${CREDENTIAL}/service-account`] = () =>
      json({ kind: 'service-account', serviceAccount: ADDRESS })
    await open(teamSpace('owner'))
    await until(() => text().includes(ADDRESS), 'the address')
    expect(text()).to.contain('with your Google sign-in')
    expect(text()).to.contain('Content manager')
    await expect(panel).to.be.accessible(A11Y)

    button('Check and switch').click()
    await until(() => text().includes('Chordless’s own account'), 'the switch')
    expect(calls.map(call => call.key)).to.include(`POST ${CREDENTIAL}/service-account`)
    expect(text()).to.contain('Use my Google sign-in instead')
  })

  it('says why the Worker would not switch, and stays on the owner’s sign-in', async () => {
    routes[`POST ${CREDENTIAL}/service-account`] = () =>
      json(
        {
          error:
            'The Team’s folder is in a My Drive: team-managed storage needs it in a Google shared drive',
        },
        409
      )
    await open(teamSpace('owner'))
    await until(() => text().includes(ADDRESS), 'the address')
    button('Check and switch').click()
    await until(() => panel.shadowRoot?.querySelector('[role="alert"]'), 'the reason')
    expect(text()).to.contain('needs it in a Google shared drive')
    expect(text()).to.contain('Check and switch')
  })

  it('goes back to the owner’s own sign-in, sending it to the Worker', async () => {
    routes[`GET ${CREDENTIAL}`] = () => json({ kind: 'service-account', serviceAccount: ADDRESS })
    routes[`PUT ${CREDENTIAL}`] = () => new Response(null, { status: 204 })
    await open(teamSpace('owner'))
    await until(() => text().includes('Chordless’s own account'), 'how it is reached')

    button('Use my Google sign-in instead').click()
    await until(() => text().includes('Check and switch'), 'back on the owner’s sign-in')
    expect(calls.find(call => call.key === `PUT ${CREDENTIAL}`)?.body).to.deep.equal({
      blob: 'the-blob',
    })
  })

  it('asks the owner to sign in first when going back and there is no sign-in on this device', async () => {
    routes[`GET ${CREDENTIAL}`] = () => json({ kind: 'service-account', serviceAccount: ADDRESS })
    await open(teamSpace('owner'))
    await until(() => text().includes('Chordless’s own account'), 'how it is reached')
    worker.stored = undefined
    button('Use my Google sign-in instead').click()
    await until(() => panel.shadowRoot?.querySelector('[role="alert"]'), 'the reason')
    expect(text()).to.contain('Sign in with Google first')
    expect(calls.some(call => call.key === `PUT ${CREDENTIAL}`)).to.equal(false)
  })

  it('says so when the Worker cannot be asked', async () => {
    routes[`GET ${CREDENTIAL}`] = () => json({ error: 'Not a member of this space' }, 403)
    await open(teamSpace('owner'))
    await until(() => panel.shadowRoot?.querySelector('[role="alert"]'), 'the reason')
    expect(text()).to.contain('Not a member of this space')
  })

  it('copies the address, and asks again for another Team', async () => {
    let copied = ''
    const clipboard = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied = value
        },
      },
    })
    try {
      await open(teamSpace('owner'))
      await until(() => text().includes(ADDRESS), 'the address')
      button('Copy').click()
      await until(() => copied === ADDRESS, 'the copy')
      await panel.updateComplete
      expect(button('Copied')).to.exist

      // (no clipboard: the address stays there to select)
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => Promise.reject(new Error('denied')) },
      })
      await panel._copy(ADDRESS)
      expect(panel._copied).to.equal(false)
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
    }

    const asked = calls.length
    panel.space = { ...teamSpace('owner'), team: { id: 'space-bbbb2222', role: 'owner' } }
    routes['GET /api/space/space-bbbb2222/credential'] = () =>
      json({ kind: 'owner', serviceAccount: ADDRESS })
    await until(() => calls.length > asked, 'the other Team')
  })
})
