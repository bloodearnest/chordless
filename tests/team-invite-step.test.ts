/**
 * The last step of making a team space (team-invite-step.ts, leadersOf): who is suggested, what is
 * sent to the Worker, and the links shown. The Worker is a fetch that answers from a table, and
 * the service worker that keeps the sign-in a fake one.
 */
import { expect } from '@open-wc/testing'
import '../src/components/team-invite-step.ts'
import type { TeamInviteStep } from '../src/components/team-invite-step.ts'
import { leadersOf } from '../src/js/team-spaces.ts'
import { makeSetlist } from './builders.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const ID_TOKEN = `${encode({ alg: 'RS256' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`

describe('leadersOf', () => {
  const person = (id: string, name: string, ...emails: string[]) => ({
    id,
    name,
    emails,
    modifiedDate: '2026-10-29T10:00:00.000Z',
  })
  const people = [
    person('sam', 'Sam'),
    person('ann', 'Ann', 'ann@example.com', 'ann@work.org'),
    person('bob', 'Bob', 'bob@example.com'),
    person('me', 'Me', 'me@example.com'),
    person('old-bob', 'Old Bob', 'oldbob@example.com'),
  ]
  people[4] = { ...people[4], mergedInto: 'bob' } as (typeof people)[number]
  const led = (leaderId?: string) => makeSetlist({ leaderId })

  it('names each leader once, those with an email first, with their first email', () => {
    const leaders = leadersOf(
      [led('sam'), led('ann'), led('ann'), led('sam'), led('old-bob')],
      people
    )
    expect(leaders).to.deep.equal([
      { name: 'Ann', email: 'ann@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Sam', email: null },
    ])
  })

  it('leaves out the person making the space, by any of their emails, and setlists nobody leads', () => {
    const leaders = leadersOf(
      [led('me'), led(), led('not-a-person'), led('bob')],
      people,
      'ME@example.com'
    )
    expect(leaders).to.deep.equal([{ name: 'Bob', email: 'bob@example.com' }])
  })
})

describe('team-invite-step', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  let page: TeamInviteStep
  let made: { path: string; body: { role: string; email: string } }[]
  let refuse: string[]

  const text = () => (page.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  const button = (label: string) =>
    must(
      Array.from(page.shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(each =>
        each.textContent?.includes(label)
      )
    )
  const boxes = () =>
    Array.from(page.shadowRoot?.querySelectorAll<HTMLInputElement>('input[type=checkbox]') ?? [])
  const roleOf = (email: string) =>
    must(page.shadowRoot?.querySelector<HTMLSelectElement>(`select[aria-label="Role of ${email}"]`))

  async function open(leaders: { name: string; email: string | null }[]) {
    page = document.createElement('team-invite-step')
    page.team = { id: 'space-eeee5555', role: 'owner' }
    page.leaders = leaders
    document.body.append(page)
    await page.updateComplete
  }

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    worker.stored = {
      blob: 'blob',
      metadata: { id_token: ID_TOKEN, scope: 'openid email profile' },
      updated_at: new Date().toISOString(),
    }
    made = []
    refuse = []
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      if (path.endsWith('/invites') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        if (refuse.includes(body.email)) {
          return Response.json({ error: 'Too many invites' }, { status: 429 })
        }
        made.push({ path, body })
        return Response.json({ code: `code-${made.length}-abcdefghijklmnop`, expiresAt: 'later' })
      }
      return Response.json({ error: 'no such route' }, { status: 404 })
    }) as typeof fetch
  })

  afterEach(() => {
    page?.remove()
    window.fetch = realFetch
    uninstallWorker()
  })

  it('suggests those with an email, ticked, and says who cannot be invited', async () => {
    await open([
      { name: 'Ann', email: 'ann@example.com' },
      { name: 'Sam', email: null },
    ])
    expect(boxes().map(box => box.checked)).to.deep.equal([true])
    expect(text()).to.contain('Ann ann@example.com')
    expect(text()).to.contain("can't be invited from here: Sam")
    expect(text()).to.contain('Make 1 invite')
  })

  it('makes an invite for each ticked person with the role chosen, and shows a link for each', async () => {
    await open([
      { name: 'Ann', email: 'ann@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Cat', email: 'cat@example.com' },
    ])
    boxes()[2].click()
    const select = roleOf('bob@example.com')
    select.value = 'reader'
    select.dispatchEvent(new Event('change'))
    await page.updateComplete
    expect(text()).to.contain('Make 2 invites')

    button('Make 2 invites').click()
    await wait(100)
    await page.updateComplete
    expect(made.map(each => each.body)).to.deep.equal([
      { role: 'writer', email: 'ann@example.com' },
      { role: 'reader', email: 'bob@example.com' },
    ])
    const links = Array.from(
      page.shadowRoot?.querySelectorAll<HTMLInputElement>('input.link') ?? []
    )
    expect(links.map(link => link.value)).to.deep.equal([
      `${window.location.origin}/join#space-eeee5555.code-1-abcdefghijklmnop`,
      `${window.location.origin}/join#space-eeee5555.code-2-abcdefghijklmnop`,
    ])
    // (those done with leave the list; the one not ticked stays)
    expect(boxes()).to.have.length(1)
    expect(text()).to.contain('Links to send')
  })

  it('copies a link, and says so', async () => {
    await open([{ name: 'Ann', email: 'ann@example.com' }])
    button('Make 1 invite').click()
    await wait(100)
    await page.updateComplete
    const written: string[] = []
    const real = navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText = async text => {
      written.push(text)
    }
    try {
      button('Copy the link').click()
      await wait(20)
      await page.updateComplete
    } finally {
      navigator.clipboard.writeText = real
    }
    expect(written[0]).to.contain('/join#space-eeee5555.')
    expect(text()).to.contain('✓ Copied')
  })

  it('goes on without saying copied when the browser will not copy', async () => {
    await open([{ name: 'Ann', email: 'ann@example.com' }])
    button('Make 1 invite').click()
    await wait(100)
    await page.updateComplete
    const real = navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText = async () => {
      throw new Error('denied')
    }
    try {
      button('Copy the link').click()
      await wait(20)
      await page.updateComplete
    } finally {
      navigator.clipboard.writeText = real
    }
    expect(text()).to.not.contain('✓ Copied')
  })

  it('adds an email by hand once, in lower case, and keeps the one that was refused to try again', async () => {
    await open([{ name: 'Ann', email: 'ann@example.com' }])
    const input = must(page.shadowRoot?.querySelector<HTMLInputElement>('#extra'))
    for (const value of ['Dan@Example.com', 'dan@example.com', '']) {
      input.value = value
      must(page.shadowRoot?.querySelector('form')).dispatchEvent(
        new Event('submit', { cancelable: true })
      )
    }
    await page.updateComplete
    expect(boxes()).to.have.length(2)

    refuse = ['dan@example.com']
    button('Make 2 invites').click()
    await wait(100)
    await page.updateComplete
    expect(text()).to.contain('dan@example.com: Too many invites')
    expect(boxes().map(box => box.checked)).to.deep.equal([true]) // dan, still to try

    refuse = []
    button('Make 1 invite').click()
    await wait(100)
    await page.updateComplete
    expect(text()).to.not.contain('Too many invites')
    expect(page.shadowRoot?.querySelectorAll('input.link')).to.have.length(2)
  })

  it('has nothing to make until someone is ticked, and asks for an address when there is no one', async () => {
    await open([])
    expect(text()).to.contain('Add the email address')
    expect(button('Make 0 invites').disabled).to.equal(true)
  })
})
