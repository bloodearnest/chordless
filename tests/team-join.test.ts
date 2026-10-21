/**
 * The page that joins a team space from an invite link (team-join.ts): signing in for who someone
 * is alone, choosing to join, and what is said when the invite is for someone else, is not good,
 * or the Worker cannot be reached. The Worker is a fetch that answers from a table, Google's
 * sign-in window a stub, and the service worker that keeps the sign-in a fake one.
 */
import { expect } from '@open-wc/testing'
import '../src/components/team-join.ts'
import { parseInvite, type TeamJoin } from '../src/components/team-join.ts'
import { offerLink, takeLink } from '../src/js/incoming-link.ts'
import { deleteSpace, getCurrentSpace, listSpaces, setCurrentSpace } from '../src/js/space.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** An ID token that ends in an hour (the signature is never checked by the page) */
const idToken = (inSeconds = 3600) =>
  `${encode({ alg: 'RS256' })}.${encode({ exp: Math.floor(Date.now() / 1000) + inSeconds })}.sig`

const TEAM = 'space-aaaa1111'
const CODE = 'abcdefghijklmnopqrstuv'
const LINK = `#${TEAM}.${CODE}`
const user = {
  name: 'Bea Singer',
  email: 'bea@example.com',
  picture: null,
  given_name: null,
  family_name: null,
  sub: '1',
}

describe('parseInvite', () => {
  it('reads the space and the code from the fragment, with or without the #', () => {
    expect(parseInvite(LINK)).to.deep.equal({ teamId: TEAM, code: CODE })
    expect(parseInvite(`${TEAM}.${CODE}`)).to.deep.equal({ teamId: TEAM, code: CODE })
  })

  it('is nothing for a fragment that is not one', () => {
    for (const fragment of [
      '',
      '#',
      '#abc',
      `#${TEAM}`,
      `#${TEAM}.short`,
      `#${TEAM}.${CODE}.extra`,
      '#sp ace.code',
    ]) {
      expect(parseInvite(fragment), fragment).to.equal(null)
    }
  })
})

describe('the join page', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  const realGoogle = (window as { google?: unknown }).google
  let routes: Record<string, () => Response>
  let requested: string[]
  let codeResponse: { code?: string; error?: string }
  let signInAnswer: () => Response
  let page: TeamJoin
  let reloads: number
  let before: { id: string | null; name: string }
  const made: string[] = []

  /** What the page says, with its line breaks and indents as single spaces */
  const text = () => (page.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  const button = (label: string) =>
    must(
      Array.from(page.shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(each =>
        each.textContent?.includes(label)
      )
    )
  async function until(condition: () => unknown, what: string) {
    for (let i = 0; i < 100 && !condition(); i++) await wait(20)
    expect(condition(), what).to.be.ok
  }

  async function open(fragment = LINK, signedIn = true) {
    if (signedIn) {
      worker.stored = {
        blob: 'blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          id_token: idToken(),
          scope: 'openid email profile',
          user,
        },
        updated_at: new Date().toISOString(),
      }
    }
    page = document.createElement('team-join')
    page.fragment = fragment
    page.reload = () => {
      reloads++
    }
    document.body.append(page)
    await page.updateComplete
  }

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    before = getCurrentSpace()
    reloads = 0
    requested = []
    codeResponse = { code: 'the-code' }
    signInAnswer = () =>
      Response.json({
        blob: 'new-blob',
        access_token: 'tok',
        expires_in: 3600,
        id_token: idToken(),
        scope: 'openid email profile',
        user,
      })
    routes = {
      'POST /api/spaces/join': () => Response.json({ spaceId: TEAM, role: 'writer' }),
      [`GET /api/space/${TEAM}/root`]: () =>
        Response.json({
          ref: TEAM,
          name: `Pat Church ${crypto.randomUUID().slice(0, 8)}`,
          trashed: false,
          canWrite: true,
        }),
    }
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      const key = `${init?.method ?? 'GET'} ${path}`
      requested.push(key)
      if (path === '/oauth/callback') return signInAnswer()
      const route = routes[key]
      return route ? route() : Response.json({ error: 'no such route' }, { status: 404 })
    }) as typeof fetch
    ;(window as { google?: unknown }).google = {
      accounts: {
        oauth2: {
          initCodeClient: (config: { scope: string; callback: (response: object) => void }) => ({
            requestCode: () => {
              requested.push(`ASK ${config.scope}`)
              config.callback(codeResponse)
            },
          }),
        },
      },
    }
  })

  afterEach(async () => {
    page?.remove()
    window.fetch = realFetch
    ;(window as { google?: unknown }).google = realGoogle
    uninstallWorker()
    for (const id of made.splice(0)) await deleteSpace(id)
    for (const space of await listSpaces()) {
      if (space.name.startsWith('Pat Church')) await deleteSpace(space.id)
    }
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  it('says the link is cut short, and asks nothing, when it has no invite in it', async () => {
    await open('#nonsense', false)
    expect(text()).to.contain("This link doesn't work")
    expect(requested).to.deep.equal([])
  })

  it('asks them to sign in first, for who they are alone, and then offers to join as who they are', async () => {
    await open(LINK, false)
    await until(
      () => text().includes('Sign in with the Google account the invite was sent to'),
      'the sign-in'
    )
    expect(text()).to.contain('no access to your Google Drive')

    button('Sign in with Google').click()
    await until(() => text().includes('bea@example.com'), 'to be signed in')
    expect(requested).to.include('ASK openid email profile')
    expect(text()).to.contain('Join the team space')
    expect(requested).to.not.include('POST /api/spaces/join')
  })

  it('offers to join as who is signed in already, and joins when told to', async () => {
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    expect(text()).to.contain('bea@example.com')
    expect(requested).to.not.include('POST /api/spaces/join')

    button('Join the team space').click()
    await until(() => text().includes('You have joined'), 'to be joined')
    expect(text()).to.contain('as a writer')
    expect(requested).to.include('POST /api/spaces/join')
    expect((await listSpaces()).some(space => space.team?.id === TEAM)).to.equal(true)
  })

  it('works when the sign-in has no profile to show: it does not say who they are', async () => {
    worker.stored = {
      blob: 'blob',
      metadata: {
        access_token: 'token',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        id_token: idToken(),
        scope: 'openid email profile',
      },
      updated_at: new Date().toISOString(),
    }
    await open(LINK, false)
    await until(() => text().includes('Join the team space'), 'the offer')
    expect(text()).to.contain('You are signed in.')

    routes['POST /api/spaces/join'] = () =>
      Response.json({ error: 'sent to a different Google account' }, { status: 403 })
    button('Join the team space').click()
    await until(() => text().includes("Couldn't join"), 'the refusal')
    expect(text()).to.contain('sent to a different Google account. Sign in with the address')
  })

  it('takes the invite the installed app was launched with, in place of the address’s', async () => {
    offerLink('/join', LINK)
    await open('', true)
    await until(() => text().includes('Join the team space'), 'the offer')
    expect(page.fragment).to.equal(LINK)
    expect(takeLink('/join')).to.equal(null)
  })

  it('takes another invite offered while it is open, and a bad one is a bad link', async () => {
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')

    offerLink('/join', '#cut-short')
    await until(() => text().includes("This link doesn't work"), 'the bad link')

    offerLink('/join', LINK)
    await until(() => text().includes('Join the team space'), 'the offer again')
    expect(takeLink('/join')).to.equal(null)
  })

  it('takes another invite link opened in the tab, and stops listening when it goes', async () => {
    await open('#cut-short', false)
    expect(text()).to.contain("This link doesn't work")

    page.fragment = LINK
    const original = window.location.hash
    window.location.hash = LINK
    try {
      await until(
        () => text().includes('Sign in with the Google account'),
        'the new link to be read'
      )
    } finally {
      window.location.hash = original
    }

    page.remove()
    offerLink('/join', '#cut-short')
    await wait(50)
    expect(takeLink('/join')).to.equal('#cut-short')
  })

  it('opens the space it joined, starting the app afresh', async () => {
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    button('Join the team space').click()
    await until(() => text().includes('You have joined'), 'to be joined')

    button('Open Pat Church').click()
    await until(() => reloads === 1, 'the app to start afresh')
    const joined = must((await listSpaces()).find(space => space.team?.id === TEAM))
    expect(getCurrentSpace().id).to.equal(joined.id)
  })

  it('says an invite for another account is, and offers to sign in with a different one', async () => {
    routes['POST /api/spaces/join'] = () =>
      Response.json(
        { error: 'This invite was sent to a different Google account' },
        { status: 403 }
      )
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    button('Join the team space').click()
    await until(() => text().includes("Couldn't join"), 'the refusal')
    expect(text()).to.contain('sent to a different Google account, not bea@example.com')

    button('Use a different account').click()
    await until(() => requested.includes('ASK openid email profile'), 'the sign-in window')
  })

  it('says an invite that is not good is not, and what to do', async () => {
    routes['POST /api/spaces/join'] = () =>
      Response.json({ error: 'This invite is not valid' }, { status: 404 })
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    button('Join the team space').click()
    await until(() => text().includes("Couldn't join"), 'the refusal')
    expect(text()).to.contain('ask the person who sent it for a new one')
    expect((await listSpaces()).some(space => space.team?.id === TEAM)).to.equal(false)
  })

  it('says what went wrong otherwise, and can try again', async () => {
    routes['POST /api/spaces/join'] = () => new Response('oops', { status: 500 })
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    button('Join the team space').click()
    await until(() => text().includes("Couldn't join"), 'the failure')
    expect(text()).to.contain('Error 500')

    button('Try again').click()
    await until(() => text().includes('Join the team space'), 'the offer again')
  })

  it('asks them to sign in again when Google no longer honours the sign-in', async () => {
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    // (the access token is good, the ID token has run out, and Google refuses a new one)
    const stored = must(worker.stored)
    worker.stored = { ...stored, metadata: { ...stored.metadata, id_token: idToken(-60) } }
    routes['POST /session/refresh'] = () =>
      Response.json({ error: 'invalid_grant' }, { status: 401 })
    window.fetch = ((original: typeof fetch) =>
      (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === '/session/refresh'
          ? Response.json({ error: 'invalid_grant' }, { status: 401 })
          : original(input, init)) as typeof fetch)(window.fetch)

    button('Join the team space').click()
    await until(() => text().includes('Sign in with the Google account'), 'the sign-in again')
  })

  it('says so when the sign-in window gives nothing', async () => {
    codeResponse = { error: 'access_denied' }
    await open(LINK, false)
    await until(() => text().includes('Sign in with Google'), 'the sign-in')
    button('Sign in with Google').click()
    await until(() => text().includes("Couldn't join"), 'the failure')
    expect(text()).to.contain('access_denied')
  })
})
