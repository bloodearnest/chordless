/**
 * A Team's list of people (people-list.ts): its members, the invites waiting and the people who only lead, in one table
 * that sorts and searches, with an editor for one person and a way to invite. The Worker is a fetch that answers from a
 * table, and the service worker that keeps the sign-in a fake one.
 */
import { expect, waitUntil } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import { SpacePeopleChangedEvent } from '../src/components/space-people.ts'
import '../src/components/people-list.ts'
import type { PeopleList } from '../src/components/people-list.ts'
import type { Person, Space } from '../src/js/data-types.ts'
import { openSpace } from '../src/js/db.ts'
import { createSpace, deleteSpace, updateSpace } from '../src/js/space.ts'
import type { TeamRole } from '../src/js/team-roles.ts'
import { makeSetlist } from './builders.ts'
import { type FakeAuthWorker, installFakeAuthWorker, sessionFor } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { clearToasts, shownToast, suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const TEAM = 'space-aaaa1111'
const NOW = new Date('2026-11-17T12:00:00Z')
const members = [
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
    createdAt: '2026-11-16T00:00:00Z',
    expiresAt: '2026-11-23T12:00:00Z',
    emailedAt: '2026-11-15T12:00:00Z',
  },
  {
    id: 'cd34',
    email: 'fay@example.com',
    role: 'writer',
    createdBy: 'ann@example.com',
    createdAt: '2026-11-16T00:00:00Z',
    expiresAt: '2026-11-20T12:00:00Z',
    emailedAt: null,
  },
]
const person = (id: string, name: string, emails: string[]): Person => ({
  id,
  name,
  emails,
  modifiedDate: '2026-11-17T00:00:00Z',
})

describe('people-list', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  const realClipboard = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard')
  let calls: { key: string; body?: unknown }[]
  let routes: Record<string, (body?: unknown) => Response>
  let list: PeopleList
  const made: string[] = []

  const json = (body: unknown, status = 200) => Response.json(body, { status })
  const done = () => new Response(null, { status: 204 })
  const text = () => (list.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  const rowsText = () =>
    Array.from(list.shadowRoot?.querySelectorAll('tbody tr') ?? []).map(row =>
      (row.querySelector('.name')?.textContent ?? '').trim()
    )
  const button = (label: string, within: ParentNode | null = list.shadowRoot) =>
    must(
      Array.from(within?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(each =>
        each.textContent?.includes(label)
      )
    )
  const rowOf = (name: string) =>
    must(
      Array.from(list.shadowRoot?.querySelectorAll('tbody tr') ?? []).find(row =>
        row.querySelector('.name')?.textContent?.includes(name)
      )
    )
  async function until(condition: () => unknown, what: string) {
    await waitUntil(() => condition(), what, { timeout: 2000 })
    expect(condition(), what).to.be.ok
  }
  const confirmModals = () =>
    Array.from(list.shadowRoot?.querySelectorAll<AppModal>('app-modal[type="confirm"]') ?? [])
  async function answer(confirm: boolean) {
    await until(() => confirmModals().some(each => each.open), 'the question to be asked')
    const modal = must(confirmModals().find(each => each.open))
    await modal.updateComplete
    must(
      modal.shadowRoot?.querySelector<HTMLElement>(
        confirm ? '.modal-btn-confirm' : '.modal-btn-cancel'
      )
    ).click()
    await until(() => !confirmModals().some(each => each.open), 'the question to be closed')
    // (the dialog's own close event comes a moment later: a question asked straight away would be closed by it)
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  async function space(role: TeamRole, extra: Partial<Space> = {}): Promise<Space> {
    const created = await createSpace(`People ${crypto.randomUUID().slice(0, 8)}`)
    made.push(created.id)
    return updateSpace(created.id, { team: { id: TEAM, role }, ...extra })
  }

  async function withPeople(shared: Space, people: Person[]) {
    const db = await openSpace(shared.id)
    try {
      await db.savePeople(people)
    } finally {
      db.db?.close()
    }
  }

  async function open(shared: Space) {
    list = document.createElement('people-list')
    list.now = () => NOW
    list.space = shared
    document.body.append(list)
    await list.updateComplete
    await until(() => list._loaded, 'the people to be read')
    await list.updateComplete
  }

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    worker.stored = {
      blob: 'the-blob',
      metadata: { session: sessionFor('access'), scope: 'openid email profile' },
      updated_at: new Date().toISOString(),
    }
    calls = []
    routes = {
      [`GET /api/space/${TEAM}/members`]: () => json(members),
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
    list?.remove()
    clearToasts()
    window.fetch = realFetch
    if (realClipboard) Object.defineProperty(Navigator.prototype, 'clipboard', realClipboard)
    uninstallWorker()
    for (const id of made.splice(0)) await deleteSpace(id).catch(() => {})
  })

  describe('what it shows', () => {
    it('is nothing without a space, and asks nothing', async () => {
      list = document.createElement('people-list')
      document.body.append(list)
      await list.updateComplete
      expect(list.shadowRoot?.textContent?.trim()).to.equal('')
      expect(calls).to.deep.equal([])
    })

    it('reads the people again when the same space becomes a team, or another one', async () => {
      const personal = await createSpace(`Own ${crypto.randomUUID().slice(0, 8)}`)
      made.push(personal.id)
      await open(personal)
      expect(calls.some(call => call.key.endsWith('/members'))).to.equal(false)
      list._loaded = false
      list.space = { ...personal, team: { id: TEAM, role: 'admin' } }
      await until(() => list._loaded, 'the members to be read')
      expect(calls.some(call => call.key === `GET /api/space/${TEAM}/members`)).to.equal(true)
    })

    it('lists members by role, with people who only lead, then the invites in a table of their own', async () => {
      const shared = await space('owner')
      await withPeople(shared, [
        person('bob', 'Bob Baker', ['bob@example.com', 'bob@home.org']),
        person('vic', 'Visiting Vic', ['vic@example.com']),
      ])
      await open(shared)
      expect(rowsText()).to.deep.equal([
        'ann@example.com',
        'dan@example.com',
        'Bob Baker',
        'cat@example.com',
        'Visiting Vic',
        'eve@example.com',
        'fay@example.com',
      ])
      expect(rowOf('Bob Baker').textContent).to.contain('bob@example.com')
      expect(rowOf('Bob Baker').textContent).to.contain('bob@home.org')
      expect(rowOf('Bob Baker').textContent).to.not.contain('leads')
      expect(rowOf('Bob Baker').textContent).to.contain('Worship leader')
      expect(rowOf('Visiting Vic').textContent).to.contain('Not a member')
      expect(text()).to.contain('Members (5)')
      expect(text()).to.contain('Invites (2)')
      expect(list.shadowRoot?.querySelectorAll('table')).to.have.length(2)
    })

    it('says when an invite was emailed, and that another was not, and how long each has left', async () => {
      await open(await space('owner'))
      expect(rowOf('eve@example.com').textContent).to.contain(
        'Invited · 6 days left · emailed 2 days ago'
      )
      expect(rowOf('fay@example.com').textContent).to.contain('Invited · 3 days left · not emailed')
    })

    it('uses the members the space kept when the Team cannot be reached', async () => {
      routes[`GET /api/space/${TEAM}/members`] = () => json({ error: 'down' }, 503)
      await open(
        await space('writer', {
          members: [
            { email: 'ann@example.com', role: 'owner' },
            { email: 'bob@example.com', role: 'writer' },
            { email: 'nameless@example.com' },
          ],
        })
      )
      expect(rowsText()).to.deep.equal(['ann@example.com', 'bob@example.com'])
    })

    it('has no invites for someone who does not look after members, and no Invite button', async () => {
      await open(await space('writer'))
      expect(rowsText()).to.not.include('eve@example.com')
      expect(calls.some(call => call.key.endsWith('/invites'))).to.equal(false)
      expect(text()).to.not.contain('Invite someone')
      expect(text()).to.contain('Edit changes a person')
    })

    it('says nobody matches when a search finds none, and has a search box only for a long list', async () => {
      const shared = await space('owner')
      await open(shared)
      expect(list.shadowRoot?.querySelector('input[type="search"]')).to.equal(null)
      const many = Array.from({ length: 6 }, (_, n) => person(`p${n}`, `Person ${n}`, []))
      await withPeople(shared, many)
      await list.load()
      await list.updateComplete
      const search = must(list.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]'))
      search.value = 'person 3'
      search.dispatchEvent(new Event('input'))
      await list.updateComplete
      expect(rowsText()).to.deep.equal(['Person 3', 'eve@example.com', 'fay@example.com'])
      search.value = 'zzz'
      search.dispatchEvent(new Event('input'))
      await list.updateComplete
      expect(text()).to.contain('Nobody matches')
    })
  })

  describe('sorting', () => {
    it('sorts by a column when its heading is pressed, and the other way when pressed again', async () => {
      await open(await space('owner'))
      const heading = (name: string) =>
        must(
          Array.from(list.shadowRoot?.querySelectorAll('th') ?? []).find(each =>
            each.textContent?.includes(name)
          )
        )
      expect(heading('Role').getAttribute('aria-sort')).to.equal('ascending')
      button('Name').click()
      await list.updateComplete
      expect(rowsText()[0]).to.equal('ann@example.com')
      expect(rowsText().at(-1)).to.equal('fay@example.com')
      expect(heading('Name').getAttribute('aria-sort')).to.equal('ascending')
      button('Name').click()
      await list.updateComplete
      expect(rowsText()[0]).to.equal('dan@example.com')
      expect(heading('Name').getAttribute('aria-sort')).to.equal('descending')
      expect(heading('Role').getAttribute('aria-sort')).to.equal('none')
    })
  })

  describe('who may edit', () => {
    it('lets a worship leader edit everyone, and sees no controls on invites', async () => {
      await open(await space('writer'))
      expect(
        Array.from(list.shadowRoot?.querySelectorAll('tbody button') ?? []).map(each =>
          each.textContent?.trim()
        )
      ).to.not.include('Revoke')
      expect(button('Edit', rowOf('cat@example.com'))).to.exist
    })

    it('lets a team member edit only their own row, and not see the others’ buttons', async () => {
      const shared = await space('reader')
      await withPeople(shared, [person('cat', 'Cat Cooper', ['cat@example.com'])])
      // (the signed-in account is cat: their row is the one they may edit)
      worker.stored = {
        blob: 'b',
        metadata: {
          session: sessionFor('access'),
          user: {
            name: 'Cat',
            email: 'cat@example.com',
            picture: null,
            given_name: null,
            family_name: null,
            sub: null,
          },
        },
        updated_at: new Date().toISOString(),
      }
      await open(shared)
      const edits = Array.from(list.shadowRoot?.querySelectorAll('tbody button') ?? [])
      expect(edits).to.have.length(1)
      expect(rowOf('Cat Cooper').querySelector('button')).to.equal(edits[0])
    })
  })

  describe('editing a person', () => {
    it('changes a member’s role, and reads the people again', async () => {
      routes[`PUT /api/space/${TEAM}/members/cat%40example.com`] = () => done()
      await open(await space('owner'))
      button('Edit', rowOf('cat@example.com')).click()
      await until(
        () => list.shadowRoot?.querySelector('select[aria-label="Role of cat@example.com"]'),
        'the editor'
      )
      const select = must(
        list.shadowRoot?.querySelector<HTMLSelectElement>(
          'select[aria-label="Role of cat@example.com"]'
        )
      )
      select.value = 'writer'
      select.dispatchEvent(new Event('change'))
      await until(() => calls.some(call => call.key.startsWith('PUT')), 'the role to be set')
      expect(calls.find(call => call.key.startsWith('PUT'))?.body).to.deep.equal({ role: 'writer' })
      expect(calls.filter(call => call.key === `GET /api/space/${TEAM}/members`)).to.have.length(2)
    })

    it('says what the Worker said when it refuses', async () => {
      routes[`PUT /api/space/${TEAM}/members/cat%40example.com`] = () =>
        json({ error: 'You cannot do that' }, 403)
      await open(await space('owner'))
      button('Edit', rowOf('cat@example.com')).click()
      await until(
        () => list.shadowRoot?.querySelector('select[aria-label="Role of cat@example.com"]'),
        'the editor'
      )
      const select = must(
        list.shadowRoot?.querySelector<HTMLSelectElement>(
          'select[aria-label="Role of cat@example.com"]'
        )
      )
      select.value = 'writer'
      select.dispatchEvent(new Event('change'))
      await until(() => text().includes('You cannot do that'), 'the refusal')
    })

    it('shows the owner’s role as it is, with nothing to change or remove', async () => {
      await open(await space('owner'))
      button('Edit', rowOf('ann@example.com')).click()
      await until(() => text().includes('Role in the Team'), 'the editor')
      expect(list.shadowRoot?.querySelector('select[aria-label^="Role of"]')).to.equal(null)
      expect(text()).to.not.contain('Remove from the Team')
      expect(text()).to.contain('The Team knows them as ann@example.com')
    })

    it('removes a member when sure, and not when not', async function () {
      this.timeout(8000)
      routes[`DELETE /api/space/${TEAM}/members/bob%40example.com`] = () => done()
      await open(await space('owner'))
      button('Edit', rowOf('bob@example.com')).click()
      await until(() => text().includes('Remove from the Team'), 'the editor')
      button('Remove from the Team').click()
      await answer(false)
      expect(calls.some(call => call.key.startsWith('DELETE'))).to.equal(false)
      button('Remove from the Team').click()
      await answer(true)
      await until(() => calls.some(call => call.key.startsWith('DELETE')), 'the removal')
    })

    it('lets an admin change those below them only', async function () {
      this.timeout(8000)
      await open(await space('admin'))
      button('Edit', rowOf('bob@example.com')).click()
      await until(() => text().includes('Role in the Team'), 'the editor')
      const select = must(
        list.shadowRoot?.querySelector<HTMLSelectElement>(
          'select[aria-label="Role of bob@example.com"]'
        )
      )
      expect(Array.from(select.options).map(each => each.value)).to.deep.equal(['reader', 'writer'])
      // (another admin: only their role is shown)
      list._closeEditor()
      await until(() => !list._editing, 'the editor to close')
      await new Promise(resolve => setTimeout(resolve, 50))
      button('Edit', rowOf('ann@example.com')).click()
      await until(() => list.shadowRoot?.querySelector('span.chip'), 'the owner')
      expect(
        list.shadowRoot?.querySelector('select[aria-label="Role of ann@example.com"]')
      ).to.equal(null)
    })

    it('gives a member with no name a person, to edit, when asked', async () => {
      const shared = await space('owner')
      await open(shared)
      button('Edit', rowOf('bob@example.com')).click()
      await until(() => text().includes('no name here yet'), 'the editor')
      button('Give them a name').click()
      await until(() => list.shadowRoot?.querySelector('space-people'), 'the person')
      expect(list._people.map(each => each.emails)).to.deep.include.members([['bob@example.com']])
    })

    it('shows a team member only what they may change: their own name, no role or removal', async () => {
      const shared = await space('reader')
      await withPeople(shared, [person('cat', 'Cat Cooper', ['cat@example.com'])])
      worker.stored = {
        blob: 'b',
        metadata: {
          session: sessionFor('access'),
          user: {
            name: 'Cat',
            email: 'cat@example.com',
            picture: null,
            given_name: null,
            family_name: null,
            sub: null,
          },
        },
        updated_at: new Date().toISOString(),
      }
      await open(shared)
      button('Edit', rowOf('Cat Cooper')).click()
      await until(() => list.shadowRoot?.querySelector('space-people'), 'the person')
      expect(list.shadowRoot?.querySelector('select[aria-label^="Role of"]')).to.equal(null)
      expect(text()).to.not.contain('Remove from the Team')
      expect(text()).to.not.contain('Give them a name')
    })

    it('reads the people again when the person is changed, and closes when they are gone', async () => {
      const shared = await space('owner')
      await withPeople(shared, [person('vic', 'Visiting Vic', [])])
      await open(shared)
      button('Edit', rowOf('Visiting Vic')).click()
      await until(() => list.shadowRoot?.querySelector('space-people'), 'the person')
      expect(list._editing).to.equal('person:vic')
      const db = await openSpace(shared.id)
      try {
        await db.savePeople([{ ...person('vic', 'Visiting Vic', []), deleted: true }])
      } finally {
        db.db?.close()
      }
      list.shadowRoot?.querySelector('space-people')?.dispatchEvent(new SpacePeopleChangedEvent())
      await until(() => list._editing === null, 'the editor to close')
    })

    it('ignores the close of another modal', async () => {
      await open(await space('owner'))
      button('Edit', rowOf('cat@example.com')).click()
      await until(() => list._editing, 'the editor')
      list._onEditorClosed(Object.assign(new Event('x'), {}))
      expect(list._editing).to.not.equal(null)
      list._onInviteClosed(Object.assign(new Event('x'), {}))
    })
  })

  describe('invites waiting', () => {
    it('revokes one', async () => {
      routes[`DELETE /api/space/${TEAM}/invites/ab12`] = () => done()
      await open(await space('owner'))
      button('Revoke', rowOf('eve@example.com')).click()
      await until(
        () => calls.some(call => call.key === `DELETE /api/space/${TEAM}/invites/ab12`),
        'the revoke'
      )
    })

    it('sends one again: a new invite is made and emailed, and the old one is revoked', async () => {
      routes[`POST /api/space/${TEAM}/invites`] = () =>
        json({ code: 'NEWCODE1234567890ab', expiresAt: 'later', emailed: true })
      routes[`DELETE /api/space/${TEAM}/invites/ab12`] = () => done()
      await open(await space('owner'))
      button('Send again', rowOf('eve@example.com')).click()
      await answer(true)
      await until(() => shownToast(), 'the message')
      expect(
        calls.find(call => call.key === `POST /api/space/${TEAM}/invites`)?.body
      ).to.deep.equal({
        role: 'reader',
        email: 'eve@example.com',
      })
      expect(calls.some(call => call.key === `DELETE /api/space/${TEAM}/invites/ab12`)).to.equal(
        true
      )
      expect(shownToast()?.message).to.contain('emailed to eve@example.com again')
    })

    it('copies the new link, and says so, when the new invite could not be emailed', async () => {
      const copied: string[] = []
      Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        get: () => ({ writeText: async (text: string) => void copied.push(text) }),
      })
      routes[`POST /api/space/${TEAM}/invites`] = () =>
        json({ code: 'NEWCODE1234567890ab', expiresAt: 'later', emailed: false })
      routes[`DELETE /api/space/${TEAM}/invites/cd34`] = () => done()
      await open(await space('owner'))
      button('Send again', rowOf('fay@example.com')).click()
      await answer(true)
      await until(() => shownToast(), 'the message')
      expect(shownToast()?.message).to.contain('could not be emailed')
      expect(copied).to.deep.equal([`${window.location.origin}/join/${TEAM}/NEWCODE1234567890ab`])
    })

    it('leaves it alone when not sure', async () => {
      await open(await space('owner'))
      button('Send again', rowOf('eve@example.com')).click()
      await answer(false)
      expect(calls.some(call => call.key === `POST /api/space/${TEAM}/invites`)).to.equal(false)
    })
  })

  describe('inviting', () => {
    const open_ = async () => {
      button('Invite someone').click()
      await until(() => list.shadowRoot?.querySelector('form.invite'), 'the form')
    }
    const fill = (email: string, role = 'writer') => {
      const form = must(list.shadowRoot?.querySelector<HTMLFormElement>('form.invite'))
      ;(form.elements.namedItem('email') as HTMLInputElement).value = email
      ;(form.elements.namedItem('role') as HTMLSelectElement).value = role
      form.requestSubmit()
    }

    it('makes an invite, says it was emailed, and shows the link to send another way', async () => {
      routes[`POST /api/space/${TEAM}/invites`] = () =>
        json({ code: 'CODE1234567890ab', expiresAt: 'later', emailed: true })
      await open(await space('owner'))
      await open_()
      fill('  New@Example.com ', 'reader')
      await until(() => list.shadowRoot?.querySelector('.made'), 'the link')
      expect(
        calls.find(call => call.key === `POST /api/space/${TEAM}/invites`)?.body
      ).to.deep.equal({
        role: 'reader',
        email: 'New@Example.com',
      })
      expect(text()).to.contain('We have emailed the invite to new@example.com')
      expect(must(list.shadowRoot?.querySelector<HTMLInputElement>('input.link')).value).to.equal(
        `${window.location.origin}/join/${TEAM}/CODE1234567890ab`
      )
      expect(list.shadowRoot?.querySelector('invite-send')).to.exist
      // (and the list is read again, to show it waiting)
      expect(
        calls.filter(call => call.key === `GET /api/space/${TEAM}/invites`).length
      ).to.be.greaterThan(1)
    })

    it('says so when it was not emailed, and what the Worker said when it refuses', async () => {
      routes[`POST /api/space/${TEAM}/invites`] = () =>
        json({ code: 'CODE1234567890ab', expiresAt: 'later', emailed: false })
      await open(await space('owner'))
      await open_()
      fill('x@example.com')
      await until(() => list.shadowRoot?.querySelector('.made'), 'the link')
      expect(text()).to.contain('could not be emailed')
      routes[`POST /api/space/${TEAM}/invites`] = () => json({ error: 'Too many invites' }, 429)
      fill('y@example.com')
      await until(() => text().includes('Too many invites'), 'the refusal')
    })

    it('offers only the roles below the inviter’s own', async () => {
      await open(await space('admin'))
      await open_()
      const select = must(list.shadowRoot?.querySelector<HTMLSelectElement>('select[name="role"]'))
      expect(Array.from(select.options).map(each => each.value)).to.deep.equal(['reader', 'writer'])
    })

    it('copies the link of the invite just made', async () => {
      const copied: string[] = []
      Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        get: () => ({ writeText: async (text: string) => void copied.push(text) }),
      })
      routes[`POST /api/space/${TEAM}/invites`] = () =>
        json({ code: 'CODE1234567890ab', expiresAt: 'later', emailed: true })
      await open(await space('owner'))
      await open_()
      fill('x@example.com')
      await until(() => list.shadowRoot?.querySelector('.made'), 'the link')
      button('Copy the link', list.shadowRoot?.querySelector('.made')).click()
      await until(() => copied.length === 1, 'the copy')
      expect(shownToast()?.message).to.contain('copied')
      // (no clipboard: the link is selected to copy by hand)
      Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        get: () => ({
          writeText: async () => {
            throw new Error('no')
          },
        }),
      })
      button('Copy the link', list.shadowRoot?.querySelector('.made')).click()
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    it('invites a person who only leads, from their editor, with their address', async () => {
      const shared = await space('owner')
      await withPeople(shared, [person('vic', 'Visiting Vic', ['vic@example.com'])])
      await open(shared)
      button('Edit', rowOf('Visiting Vic')).click()
      await until(() => text().includes('Invite them to the Team'), 'the editor')
      button('Invite them to the Team').click()
      await until(() => list.shadowRoot?.querySelector('form.invite'), 'the form')
      await until(
        () =>
          list.shadowRoot?.querySelector<HTMLInputElement>('input[type="email"]')?.value ===
          'vic@example.com',
        'their address'
      )
    })
  })

  describe('details', () => {
    it('says when an invite was emailed: today, yesterday, or days ago', async () => {
      await open(await space('owner'))
      expect(list._ago('2026-11-17T08:00:00Z')).to.equal('today')
      expect(list._ago('2026-11-16T12:00:00Z')).to.equal('yesterday')
      expect(list._ago('2026-11-14T12:00:00Z')).to.equal('3 days ago')
      // (and it uses the real clock when it is not given one)
      expect(document.createElement('people-list').now()).to.be.instanceOf(Date)
    })

    it('marks who is using the app, and says nothing of how many setlists anyone leads by a choice made on the device', async () => {
      const shared = await space('owner')
      await withPeople(shared, [
        person('bob', 'Bob Baker', ['bob@example.com']),
        person('vic', 'Visiting Vic', []),
      ])
      const db = await openSpace(shared.id)
      try {
        await db.saveSetlist(makeSetlist({ id: 'a', leaderId: 'bob' }))
        await db.saveSetlist(makeSetlist({ id: 'b', leaderId: 'bob' }))
      } finally {
        db.db?.close()
      }
      localStorage.setItem(`chordless:me:${shared.id}`, 'vic')
      try {
        await open(shared)
        expect(rowOf('Bob Baker').textContent).to.not.contain('leads')
        expect(rowOf('Visiting Vic').textContent).to.contain('you')
        expect(rowOf('Bob Baker').textContent).to.not.contain('you')
      } finally {
        localStorage.removeItem(`chordless:me:${shared.id}`)
      }
    })

    it('shows nothing of an editor for a person who is not in the list', async () => {
      await open(await space('owner'))
      list._editing = 'person:nobody'
      await list.updateComplete
      expect(text()).to.not.contain('Role in the Team')
    })

    it('says what went wrong at the list when a revoke is refused', async () => {
      routes[`DELETE /api/space/${TEAM}/invites/ab12`] = () => json({ error: 'Not today' }, 400)
      await open(await space('owner'))
      button('Revoke', rowOf('eve@example.com')).click()
      await until(() => text().includes('Not today'), 'the message')
    })

    it('still says the invite was not emailed when the new link cannot be copied', async () => {
      Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        get: () => ({
          writeText: async () => {
            throw new Error('not allowed')
          },
        }),
      })
      routes[`POST /api/space/${TEAM}/invites`] = () =>
        json({ code: 'NEWCODE1234567890ab', expiresAt: 'later', emailed: false })
      routes[`DELETE /api/space/${TEAM}/invites/cd34`] = () => done()
      await open(await space('owner'))
      button('Send again', rowOf('fay@example.com')).click()
      await answer(true)
      await until(() => shownToast(), 'the message')
      expect(shownToast()?.message).to.contain('could not be emailed')
    })
  })

  describe('in a Personal space', () => {
    const personal = async (updates: Partial<Space> = {}) => {
      const created = await createSpace(`Mine ${crypto.randomUUID().slice(0, 8)}`)
      made.push(created.id)
      return updateSpace(created.id, updates)
    }

    it('lists the people who lead setlists, with no roles, statuses, invites or Worker', async () => {
      const mine = await personal()
      await withPeople(mine, [
        person('ann', 'Ann Lee', ['ann@example.com']),
        person('vic', 'Visiting Vic', []),
      ])
      await open(mine)
      expect(rowsText()).to.deep.equal(['Ann Lee', 'Visiting Vic'])
      expect(text()).to.contain('People who lead setlists (2)')
      const headings = Array.from(list.shadowRoot?.querySelectorAll('th') ?? []).map(each =>
        each.textContent?.trim()
      )
      expect(headings).to.deep.equal(['Name', 'Email', 'Actions'])
      expect(text()).to.not.contain('Invite someone')
      expect(text()).to.not.contain('Not a member')
      expect(text()).to.contain('Two spellings of one person')
      expect(calls).to.deep.equal([])
      expect(button('Edit', rowOf('Ann Lee'))).to.exist
    })

    it('opens an editor with a name and addresses, and nothing of a Team', async () => {
      const mine = await personal()
      await withPeople(mine, [person('ann', 'Ann Lee', ['ann@example.com'])])
      await open(mine)
      button('Edit', rowOf('Ann Lee')).click()
      await until(() => list.shadowRoot?.querySelector('space-people'), 'the person')
      expect(text()).to.not.contain('Role in the Team')
      expect(text()).to.not.contain('Remove from the Team')
    })

    it('says nobody leads a setlist yet, and that a search found nobody', async () => {
      await open(await personal())
      expect(text()).to.contain('Nobody leads a setlist here yet')
      list._query = 'zzz'
      await list.updateComplete
      expect(text()).to.contain('Nobody matches')
    })

    it('can be looked at but not changed when the space is view only', async () => {
      const mine = await personal({ readOnly: true })
      await withPeople(mine, [person('ann', 'Ann Lee', [])])
      await open(mine)
      expect(rowOf('Ann Lee').querySelector('button')).to.equal(null)
      expect(text()).to.contain('view only')
    })

    it('reads the people again for another space', async () => {
      const first = await personal()
      const second = await personal()
      await withPeople(first, [person('ann', 'Ann Lee', [])])
      await withPeople(second, [person('bea', 'Bea Singer', [])])
      await open(first)
      expect(rowsText()).to.deep.equal(['Ann Lee'])
      list.space = second
      await until(() => rowsText()[0] === 'Bea Singer', 'the other space’s people')
    })
  })
})
