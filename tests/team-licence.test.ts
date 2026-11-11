/**
 * A space's CCLI licence number (space-licence.ts, team-licence-panel.ts): a Team's is the
 * Worker's, which this device copies; a personal space's is kept here alone. The Worker is a fetch
 * that answers from a table, and the service worker that keeps the sign-in a fake one.
 */
import { expect, waitUntil } from '@open-wc/testing'
import '../src/components/team-licence-panel.ts'
import type { TeamLicencePanel } from '../src/components/team-licence-panel.ts'
import type { Space } from '../src/js/data-types.ts'
import { createSpace, deleteSpace, getSpaceById } from '../src/js/space.ts'
import { mayEditLicence, noteLicence, readLicence, saveLicence } from '../src/js/space-licence.ts'
import type { TeamRole } from '../src/js/team-roles.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const ID_TOKEN = `${encode({ alg: 'RS256' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
const TEAM = 'space-bbbb2222'
const LICENCE = `/api/space/${TEAM}/licence`

describe('a space’s CCLI licence number', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  let calls: { key: string; body?: unknown }[]
  /** What the Worker has, and whether it answers */
  let theirs: string | null
  let down: boolean
  let refuse: boolean
  /** The log the Worker shows an admin (a set, by default) */
  let log: { at: string; by: string; from: string | null; to: string | null }[] | null
  const made: string[] = []

  const json = (body: unknown, status = 200) => Response.json(body, { status })

  /** A space on this device, as a Team in this role (or personal), deleted at the end of the test */
  async function space(role: TeamRole | null, local?: string): Promise<Space> {
    const created = await createSpace(`Licence ${crypto.randomUUID().slice(0, 8)}`)
    made.push(created.id)
    return {
      ...created,
      ...(local ? { ccliLicence: local } : {}),
      ...(role ? { team: { id: TEAM, role } } : {}),
    }
  }
  const stored = async (space: Space) => (await getSpaceById(space.id))?.ccliLicence

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    worker.stored = {
      blob: 'blob',
      metadata: { id_token: ID_TOKEN, scope: 'openid email profile' },
      updated_at: new Date().toISOString(),
    }
    calls = []
    theirs = null
    down = false
    refuse = false
    log = null
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname !== LICENCE) return json({ error: 'no such route' }, 404)
      const method = init?.method ?? 'GET'
      calls.push({ key: method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (down) throw new TypeError('offline')
      if (method === 'GET') {
        return json({
          ccliLicence: theirs,
          history: log ?? [
            { at: '2026-11-11T10:00:00Z', by: 'ann@example.com', from: null, to: theirs },
          ],
        })
      }
      if (refuse) return json({ error: 'Only an admin can change the licence number' }, 403)
      const body = JSON.parse(String(init?.body)) as { ccliLicence: string }
      theirs = body.ccliLicence || null
      return json({ ccliLicence: theirs })
    }) as typeof fetch
  })

  afterEach(async () => {
    window.fetch = realFetch
    uninstallWorker()
    for (const id of made.splice(0)) await deleteSpace(id).catch(() => {})
  })

  describe('who may set it', () => {
    it('is anyone for a personal space, a writer where a Team has none, and an admin to change it', async () => {
      expect(mayEditLicence(await space(null), '1')).to.equal(true)
      expect(mayEditLicence(await space('reader'), null)).to.equal(false)
      expect(mayEditLicence(await space('writer'), null)).to.equal(true)
      expect(mayEditLicence(await space('writer'), '1')).to.equal(false)
      expect(mayEditLicence(await space('admin'), '1')).to.equal(true)
    })
  })

  describe('reading it', () => {
    it('comes from the Worker for a Team, which this device then copies', async () => {
      theirs = '471102'
      const team = await space('writer')
      expect((await readLicence(team)).ccliLicence).to.equal('471102')
      expect(await stored(team)).to.equal('471102')
    })

    it('is the one kept here for a personal space, with no call to the Worker', async () => {
      const mine = await space(null, '555')
      expect((await readLicence(mine)).ccliLicence).to.equal('555')
      expect(calls).to.deep.equal([])
    })
  })

  describe('saving it', () => {
    it('goes to the Worker first for a Team, tidied, and is then copied here', async () => {
      const team = await space('admin')
      await saveLicence(team, ' CCLI License # 47 1102 ')
      expect(calls).to.deep.equal([{ key: 'PUT', body: { ccliLicence: '471102' } }])
      expect(await stored(team)).to.equal('471102')
    })

    it('changes nothing here when the Worker refuses', async () => {
      refuse = true
      const team = await space('writer', '111')
      let said = ''
      try {
        await saveLicence(team, '222')
      } catch (error) {
        said = (error as Error).message
      }
      expect(said).to.contain('Only an admin')
      expect(await stored(team)).to.equal(undefined)
    })

    it('is kept here alone for a personal space, and clearing it removes it', async () => {
      const mine = await space(null)
      await saveLicence(mine, '555')
      expect(await stored(mine)).to.equal('555')
      await saveLicence({ ...mine, ccliLicence: '555' }, '')
      expect(await stored(mine)).to.equal(undefined)
      expect(calls).to.deep.equal([])
    })
  })

  describe('noting the one a SongSelect chart carries', () => {
    it('is sent to the Worker by a writer where the team has none, and copied here', async () => {
      const team = await space('writer')
      await noteLicence(team, '471102')
      expect(theirs).to.equal('471102')
      expect(await stored(team)).to.equal('471102')
    })

    it('is not sent over a number the team already has: theirs is copied here instead', async () => {
      theirs = '999'
      const team = await space('writer', '471102')
      await noteLicence(team, '471102')
      expect(calls.map(each => each.key)).to.deep.equal(['GET'])
      expect(theirs).to.equal('999')
      expect(await stored(team)).to.equal('999')
    })

    it('is kept here for a reader, who cannot send it', async () => {
      const team = await space('reader')
      await noteLicence(team, '471102')
      expect(calls.map(each => each.key)).to.deep.equal(['GET'])
      expect(await stored(team)).to.equal('471102')
    })

    it('is kept here when the Worker cannot be reached, with nothing said', async () => {
      down = true
      const team = await space('writer')
      await noteLicence(team, '471102')
      expect(await stored(team)).to.equal('471102')
    })

    it('does not overwrite a personal space’s own number', async () => {
      const mine = await space(null, '555')
      await noteLicence(mine, '471102')
      expect(await stored(mine)).to.equal(undefined)
      expect(calls).to.deep.equal([])
    })
  })

  describe('the panel', () => {
    let panel: TeamLicencePanel
    const text = () => (panel.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
    const input = () => must(panel.shadowRoot?.querySelector<HTMLInputElement>('#licence'))
    const open = async (team: Space) => {
      panel = document.createElement('team-licence-panel')
      panel.space = team
      document.body.append(panel)
      await waitUntil(() => panel._loaded, 'loaded', { timeout: 2000 })
      await panel.updateComplete
    }
    afterEach(() => panel?.remove())

    it('shows an admin the number, who set it and when, and saves a new one', async () => {
      theirs = '471102'
      await open(await space('admin'))
      expect(input().value).to.equal('471102')
      expect(text()).to.contain('ann@example.com set it to 471102')
      input().value = '471103'
      input().dispatchEvent(new Event('input'))
      must(panel.shadowRoot?.querySelector<HTMLButtonElement>('#save-licence')).click()
      await waitUntil(() => theirs === '471103', 'saved', { timeout: 2000 })
      await waitUntil(() => text().includes('Saved'), 'said so', { timeout: 2000 })
    })

    it('words each change in the log: set, changed and cleared', async () => {
      const at = '2026-11-11T10:00:00Z'
      log = [
        { at, by: 'ann@example.com', from: null, to: '1' },
        { at, by: 'dan@example.com', from: '1', to: '2' },
        { at, by: 'ann@example.com', from: '2', to: null },
      ]
      await open(await space('admin'))
      expect(text()).to.contain('ann@example.com set it to 1')
      expect(text()).to.contain('dan@example.com changed it from 1 to 2')
      expect(text()).to.contain('ann@example.com cleared it (was 2)')
    })

    it('shows a personal space’s own number, with no log, and shows nothing without a space', async () => {
      await open(await space(null, '555'))
      expect(input().value).to.equal('555')
      expect(panel.shadowRoot?.querySelector('.history')).to.equal(null)
      const none = document.createElement('team-licence-panel')
      document.body.append(none)
      await none.updateComplete
      expect(none.shadowRoot?.textContent?.trim()).to.equal('')
      none.remove()
      await panel.updateComplete
    })

    it('shows a writer a number already set, but not to change', async () => {
      theirs = '471102'
      await open(await space('writer'))
      expect(input().disabled).to.equal(true)
      expect(text()).to.contain('Only an admin can change it')
      expect(panel.shadowRoot?.querySelector('#save-licence')).to.equal(null)
    })

    it('says what went wrong when the Worker refuses, and keeps what was typed', async () => {
      await open(await space('writer'))
      refuse = true
      input().value = '222'
      input().dispatchEvent(new Event('input'))
      must(panel.shadowRoot?.querySelector<HTMLButtonElement>('#save-licence')).click()
      await waitUntil(() => text().includes('Only an admin'), 'refusal shown', { timeout: 2000 })
      expect(input().value).to.equal('222')
    })

    it('says so when the number cannot be read', async () => {
      down = true
      await open(await space('admin'))
      expect(panel.shadowRoot?.querySelector('[role=alert]')).to.not.equal(null)
    })
  })
})
