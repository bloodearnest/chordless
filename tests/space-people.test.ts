/**
 * The people who lead a space's setlists, in the modal behind a space's "Leaders" button
 * (space-people.ts, docs/IDENTITIES.md): changing a name and addresses, merging and deleting.
 */
import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import type { AppModal } from '../src/components/app-modal.ts'
import type { SpacePeople } from '../src/components/space-people.ts'
import type { Person } from '../src/js/data-types.ts'
import { type ChordlessDB, openSpace } from '../src/js/db.ts'
import { createSpace, deleteSpace, updateSpace } from '../src/js/space.ts'
import { personHasLocalChanges } from '../src/js/sync/person-hash.ts'
import { makeSetlist } from './builders.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { shownToast, suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/space-people.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const NOW = '2026-10-29T10:00:00.000Z'
const person = (over: Partial<Person> & { id: string; name: string }): Person => ({
  emails: [],
  modifiedDate: NOW,
  ...over,
})

describe('space-people', () => {
  let spaceId: string
  let db: ChordlessDB
  let element: SpacePeople
  let auth: ReturnType<typeof installFakeAuthWorker>

  beforeEach(async () => {
    auth = installFakeAuthWorker()
    const space = await createSpace(`People ${crypto.randomUUID().slice(0, 8)}`)
    spaceId = space.id
    db = await openSpace(spaceId)
  })

  afterEach(async () => {
    auth.uninstall()
    element?.remove()
    db.db?.close()
    localStorage.removeItem(`chordless:me:${spaceId}`)
    await deleteSpace(spaceId)
  })

  async function open() {
    element = await fixture<SpacePeople>(html`<space-people .spaceId=${spaceId}></space-people>`)
    await waitUntil(() => element._loaded, 'the people to be read')
    return element
  }
  const $$ = (selector: string) => [
    ...(element.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []),
  ]
  const text = () => element.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''
  const card = (name: string) =>
    must(
      $$('.person').find(each => each.querySelector<HTMLInputElement>('.name')?.value === name),
      `the card of ${name}`
    )
  const stored = async (id: string) => must(await db.getPerson(id))
  const settled = async () => {
    await element.updateComplete
    await new Promise(resolve => setTimeout(resolve, 60))
    await element.updateComplete
  }
  /** Answer the question the modal asks */
  const answer = async (yes: boolean) => {
    const modal = must(element.shadowRoot?.querySelector<AppModal>('app-modal'))
    await waitUntil(() => modal.open, 'the question')
    const root = must(modal.shadowRoot)
    must(
      root.querySelector<HTMLButtonElement>(yes ? '.modal-btn-confirm' : '.modal-btn-cancel')
    ).click()
    await settled()
  }

  const ann = person({ id: 'ann', name: 'Ann Lee', emails: ['ann@example.com'] })
  const tom = person({ id: 'tom', name: 'Tom S.' })
  const tomSmith = person({ id: 'tom-smith', name: 'Tom Smith', emails: ['tom@example.com'] })

  it('says so, and makes no database, for a space that is not on this device', async () => {
    const before = (await indexedDB.databases()).length
    element = await fixture<SpacePeople>(html`<space-people spaceId="space-gone"></space-people>`)
    await waitUntil(() => element._loaded, 'the people to be read')
    expect(text()).to.contain('not on this device')
    expect((await indexedDB.databases()).length).to.equal(before)
  })

  it('says so when nobody leads a setlist here', async () => {
    await open()
    expect(text()).to.contain('Nobody leads a setlist here yet')
  })

  it('lists the people with their addresses and how many setlists they lead', async () => {
    await db.savePeople([ann, tomSmith, person({ id: 'gone', name: 'Gone', deleted: true })])
    await db.saveSetlist(makeSetlist({ id: 'a', leaderId: 'ann' }))
    await db.saveSetlist(makeSetlist({ id: 'b', leaderId: 'ann' }))
    await open()
    expect(
      $$('.person').map(each => each.querySelector<HTMLInputElement>('.name')?.value)
    ).to.deep.equal(['Ann Lee', 'Tom Smith'])
    expect(card('Ann Lee').textContent).to.contain('leads 2')
    expect(card('Ann Lee').textContent).to.contain('ann@example.com')
    expect(card('Tom Smith').textContent).to.contain('leads none')
  })

  it('marks the person using the app', async () => {
    await db.savePeople([ann, tomSmith])
    localStorage.setItem(`chordless:me:${spaceId}`, 'tom-smith')
    await open()
    expect(card('Tom Smith').textContent).to.contain('you')
    expect(card('Ann Lee').textContent).to.not.contain('you')
  })

  it('knows the person using the app by the signed-in address', async () => {
    auth.worker.stored = {
      blob: 'blob',
      metadata: {
        access_token: 'token',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        user: {
          picture: null,
          given_name: null,
          family_name: null,
          sub: '1',
          name: 'Whoever',
          email: 'ann@example.com',
        },
      },
      updated_at: new Date().toISOString(),
    } as never
    await db.savePeople([ann, tomSmith])
    await open()
    expect(card('Ann Lee').textContent).to.contain('you')
  })

  describe('changing a person', () => {
    it('renames them, and puts the old name back for an empty one', async () => {
      await db.savePeople([ann])
      await open()
      const name = card('Ann Lee').querySelector<HTMLInputElement>('.name') as HTMLInputElement
      name.value = '  Anne Lee '
      name.dispatchEvent(new Event('change'))
      await settled()
      expect((await stored('ann')).name).to.equal('Anne Lee')

      const again = card('Anne Lee').querySelector<HTMLInputElement>('.name') as HTMLInputElement
      again.value = '  '
      again.dispatchEvent(new Event('change'))
      await settled()
      expect(again.value).to.equal('Anne Lee')
      expect((await stored('ann')).name).to.equal('Anne Lee')
    })

    it('adds an address, lower-cased, and removes one', async () => {
      await db.savePeople([ann])
      await open()
      const form = card('Ann Lee').querySelector<HTMLFormElement>('form.add') as HTMLFormElement
      const input = form.elements.namedItem('email') as HTMLInputElement
      input.value = 'ANN@Work.org'
      form.requestSubmit()
      await settled()
      expect((await stored('ann')).emails).to.deep.equal(['ann@example.com', 'ann@work.org'])
      expect(card('Ann Lee').textContent).to.contain('ann@work.org')

      card('Ann Lee')
        .querySelector<HTMLButtonElement>('button[aria-label="Remove ann@example.com"]')
        ?.click()
      await settled()
      expect((await stored('ann')).emails).to.deep.equal(['ann@work.org'])
    })

    it('refuses an address that is not one, or is another person’s, and says why', async () => {
      await db.savePeople([ann, tomSmith])
      await open()
      const form = card('Ann Lee').querySelector<HTMLFormElement>('form.add') as HTMLFormElement
      const input = form.elements.namedItem('email') as HTMLInputElement
      input.value = 'nonsense'
      form.requestSubmit()
      await settled()
      expect(input.validationMessage).to.contain('does not look like')
      input.dispatchEvent(new Event('input'))
      expect(input.validationMessage).to.equal('')

      input.value = 'tom@example.com'
      form.requestSubmit()
      await settled()
      expect(input.validationMessage).to.contain('Tom Smith has that address')
      expect((await stored('ann')).emails).to.deep.equal(['ann@example.com'])
    })
  })

  describe('merging', () => {
    it('merges a person into another after asking: the setlists, the addresses and the list follow', async () => {
      await db.savePeople([ann, tom, tomSmith])
      await db.saveSetlist(makeSetlist({ id: 'a', leaderId: 'tom' }))
      await open()
      const select = card('Tom S.').querySelector<HTMLSelectElement>('select') as HTMLSelectElement
      expect([...select.options].map(o => o.text)).to.deep.equal([
        'Merge into…',
        'Ann Lee',
        'Tom Smith',
      ])
      select.value = 'tom-smith'
      select.dispatchEvent(new Event('change'))
      await answer(true)

      expect(must(await db.getSetlist('a')).leaderId).to.equal('tom-smith')
      expect((await stored('tom')).mergedInto).to.equal('tom-smith')
      expect($$('.person')).to.have.length(2)
      expect(card('Tom Smith').textContent).to.contain('leads 1')
    })

    it('leaves them as they were when the question is turned down', async () => {
      await db.savePeople([tom, tomSmith])
      await open()
      const select = card('Tom S.').querySelector<HTMLSelectElement>('select') as HTMLSelectElement
      select.value = 'tom-smith'
      select.dispatchEvent(new Event('change'))
      await answer(false)

      expect((await stored('tom')).mergedInto).to.equal(undefined)
      expect(select.value).to.equal('')
      expect($$('.person')).to.have.length(2)
    })

    it('does nothing for a choice that is not a person, and offers no merge to the only person', async () => {
      await db.savePeople([ann])
      await open()
      expect(card('Ann Lee').querySelector('select')).to.equal(null)
      await db.savePeople([tomSmith])
      await element.load()
      await element.updateComplete
      const select = card('Ann Lee').querySelector<HTMLSelectElement>('select') as HTMLSelectElement
      select.innerHTML = '<option value="">Merge into…</option><option value="zed">Zed</option>'
      select.value = 'zed'
      select.dispatchEvent(new Event('change'))
      await settled()
      expect((await stored('ann')).mergedInto).to.equal(undefined)
    })
  })

  describe('deleting', () => {
    it('deletes a person who leads nothing, after asking, and not one who leads a setlist', async () => {
      await db.savePeople([ann, tomSmith])
      await db.saveSetlist(makeSetlist({ id: 'a', leaderId: 'ann' }))
      await open()
      const leads = card('Ann Lee').querySelector<HTMLButtonElement>(
        '.actions button'
      ) as HTMLButtonElement
      expect(leads.disabled).to.equal(true)
      expect(leads.title).to.equal('They lead setlists')

      card('Tom Smith').querySelector<HTMLButtonElement>('.actions button')?.click()
      await answer(true)

      expect((await stored('tom-smith')).deleted).to.equal(true)
      expect($$('.person')).to.have.length(1)
    })

    it('keeps them when the question is turned down, and does not offer to delete the person using the app', async () => {
      await db.savePeople([ann, tomSmith])
      localStorage.setItem(`chordless:me:${spaceId}`, 'ann')
      await open()
      const me = card('Ann Lee').querySelector<HTMLButtonElement>(
        '.actions button'
      ) as HTMLButtonElement
      expect(me.disabled).to.equal(true)
      expect(me.title).to.equal('This is you')

      card('Tom Smith').querySelector<HTMLButtonElement>('.actions button')?.click()
      await answer(false)
      expect((await stored('tom-smith')).deleted).to.equal(undefined)
    })
  })

  describe('in a Team, a team member naming themselves', () => {
    const encode = (value: object) =>
      btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const ID_TOKEN = `${encode({ alg: 'RS256' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
    const realFetch = window.fetch
    let calls: { path: string; method?: string; body: { name: string } }[]
    let answer: () => Response

    beforeEach(async () => {
      calls = []
      answer = () =>
        Response.json({
          file: {
            ref: 'file-ann',
            name: 'ann.json',
            props: {},
            rev: 'rev-2',
            modified: 'm',
            created: 'c',
          },
          person: { ...ann, name: 'Anne Lee', modifiedDate: '2026-11-01T00:00:00.000Z' },
        })
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (!path.includes('/people/'))
          return Response.json({ error: 'no such route' }, { status: 404 })
        calls.push({ path, method: init?.method, body: JSON.parse(String(init?.body)) })
        return answer()
      }) as typeof fetch
      auth.worker.stored = {
        blob: 'blob',
        metadata: {
          id_token: ID_TOKEN,
          access_token: 'token',
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          user: {
            picture: null,
            given_name: null,
            family_name: null,
            sub: '1',
            name: 'Ann',
            email: 'ann@example.com',
          },
        },
        updated_at: new Date().toISOString(),
      } as never
      await updateSpace(spaceId, {
        team: { id: 'team-1', role: 'reader' },
        members: [
          { email: 'ann@example.com', role: 'reader' },
          { email: 'tom@example.com', role: 'writer' },
          { email: 'hal@example.com', role: 'admin' },
        ],
      })
      await db.savePeople([
        ann,
        person({ id: 'tom', name: 'Tom Ray', emails: ['tom@example.com'] }),
      ])
    })

    afterEach(() => {
      window.fetch = realFetch
    })

    it('may change the name of the person they are, and no one else’s', async () => {
      await open()
      const own = card('Ann Lee').querySelector<HTMLInputElement>('.name') as HTMLInputElement
      const other = card('Tom Ray').querySelector<HTMLInputElement>('.name') as HTMLInputElement
      expect(own.disabled).to.equal(false)
      expect(other.disabled).to.equal(true)
      expect(card('Ann Lee').querySelector('form.add')).to.equal(null)
      expect(text()).to.contain('you can change your own name')
    })

    it('asks the Worker, and keeps its answer as already sent', async () => {
      await open()
      const own = card('Ann Lee').querySelector<HTMLInputElement>('.name') as HTMLInputElement
      own.value = '  Anne Lee '
      own.dispatchEvent(new Event('change'))
      await settled()

      expect(calls).to.have.length(1)
      expect(calls[0].path).to.equal('/api/space/team-1/people/ann/name')
      expect(calls[0].method).to.equal('PUT')
      expect(calls[0].body).to.deep.equal({ name: 'Anne Lee' })
      const now = await stored('ann')
      expect(now.name).to.equal('Anne Lee')
      expect(now.fileRef).to.equal('file-ann')
      expect(personHasLocalChanges(now)).to.equal(false)
      expect(card('Anne Lee')).to.exist
    })

    it('says so, and leaves the name as it was, when the Worker refuses', async () => {
      answer = () => Response.json({ error: 'That person is not you' }, { status: 403 })
      await open()
      const own = card('Ann Lee').querySelector<HTMLInputElement>('.name') as HTMLInputElement
      own.value = 'Somebody Else'
      own.dispatchEvent(new Event('change'))
      await settled()

      expect((await stored('ann')).name).to.equal('Ann Lee')
      expect(shownToast()?.message).to.contain("Couldn't change your name")
      expect(own.value).to.equal('Ann Lee')
    })

    it('does not ask the Worker for an empty name', async () => {
      await open()
      const own = card('Ann Lee').querySelector<HTMLInputElement>('.name') as HTMLInputElement
      own.value = ' '
      own.dispatchEvent(new Event('change'))
      await settled()
      expect(calls).to.deep.equal([])
      expect(own.value).to.equal('Ann Lee')
    })

    it('shows what each person is in the Team, by the address the Team knows them by', async () => {
      await db.savePeople([person({ id: 'hal', name: 'Hal', emails: ['hal@example.com'] })])
      await open()
      const role = (name: string) => card(name).querySelector('.role')?.textContent?.trim()
      expect(role('Ann Lee')).to.equal('team member')
      expect(role('Tom Ray')).to.equal('worship leader')
      expect(role('Hal')).to.equal('admin')
    })

    it('shows no role for a person the Team has no member for, or in a space of one’s own', async () => {
      await db.savePeople([person({ id: 'vic', name: 'Visiting Vic' })])
      await open()
      expect(Boolean(card('Visiting Vic').querySelector('.role'))).to.equal(false)
      await updateSpace(spaceId, { team: undefined })
      await element.load()
      await element.updateComplete
      expect(Boolean(card('Ann Lee').querySelector('.role'))).to.equal(false)
    })
  })

  describe('in a Team', () => {
    it('lets a worship leader change the people', async () => {
      await updateSpace(spaceId, { team: { id: 'team-1', role: 'writer' } })
      await db.savePeople([ann])
      await open()
      expect(card('Ann Lee').querySelector('form.add')).to.not.equal(null)
      expect(text()).to.not.contain('Only worship leaders')
    })

    it('shows a team member the people, and changes nothing', async () => {
      await updateSpace(spaceId, { team: { id: 'team-1', role: 'reader' } })
      await db.savePeople([ann, tomSmith])
      await open()
      expect(text()).to.contain('Only worship leaders can change them')
      const name = card('Ann Lee').querySelector<HTMLInputElement>('.name') as HTMLInputElement
      expect(name.disabled).to.equal(true)
      expect(card('Ann Lee').querySelector('form.add')).to.equal(null)
      expect(card('Ann Lee').querySelector('select')).to.equal(null)
      expect(card('Ann Lee').querySelector('.email button')).to.equal(null)
    })
  })

  it('says in a message when a change cannot be saved, and shows the people as they are', async () => {
    await db.savePeople([ann])
    await open()
    const real = Object.getPrototypeOf(db).savePeople
    Object.getPrototypeOf(db).savePeople = () => Promise.reject(new Error('disk full'))
    try {
      const name = card('Ann Lee').querySelector<HTMLInputElement>('.name') as HTMLInputElement
      name.value = 'Anne'
      name.dispatchEvent(new Event('change'))
      await settled()
    } finally {
      Object.getPrototypeOf(db).savePeople = real
    }
    expect((await stored('ann')).name).to.equal('Ann Lee')
    // (the field shows the name it has, not what was typed and not saved)
    expect(card('Ann Lee').querySelector<HTMLInputElement>('.name')?.value).to.equal('Ann Lee')
  })

  it('reads the people again when it is given another space', async () => {
    await db.savePeople([ann])
    await open()
    const other = await createSpace(`Other ${crypto.randomUUID().slice(0, 8)}`)
    const otherDb = await openSpace(other.id)
    try {
      await otherDb.savePeople([tomSmith])
      element.spaceId = other.id
      await waitUntil(
        () =>
          $$('.person').length === 1 &&
          $$('.name').some(each => (each as HTMLInputElement).value === 'Tom Smith'),
        'the other people'
      )
    } finally {
      otherDb.db?.close()
      await deleteSpace(other.id)
    }
  })
})
