/**
 * The page that joins a team space from an invite link (team-join.ts): signing in for who someone
 * is alone, choosing to join, and what is said when the invite is for someone else, is not good,
 * or the Worker cannot be reached. The Worker is a fetch that answers from a table, Google's
 * sign-in window a stub, and the service worker that keeps the sign-in a fake one.
 */
import { expect, waitUntil } from '@open-wc/testing'
import { trace } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import '../src/components/team-join.ts'
import type { SignInForm } from '../src/components/sign-in-form.ts'
import { parseInvite, type TeamJoin } from '../src/components/team-join.ts'
import { ChordlessDB } from '../src/js/db.ts'
import { offerLink, takeLink } from '../src/js/incoming-link.ts'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import { addChart } from '../src/js/song-utils.ts'
import {
  createSpace,
  deleteSpace,
  getCurrentSpace,
  listSpaces,
  setCurrentSpace,
} from '../src/js/space.ts'
import type { ProgressCallback } from '../src/js/sync-manager.ts'
import { makeSetlist } from './builders.ts'
import { type FakeAuthWorker, installFakeAuthWorker, sessionFor } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { nothingFor, suppressConsoleLogs } from './test-helpers.ts'

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
  let shown: number
  let synced: string[]
  let syncFails: boolean
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
    await waitUntil(() => condition(), undefined, { timeout: 2000 })
    expect(condition(), what).to.be.ok
  }

  async function open(
    fragment = LINK,
    signedIn = true,
    configure: (page: TeamJoin) => void = () => {}
  ) {
    if (signedIn) {
      worker.stored = {
        blob: 'blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          id_token: idToken(),
          session: sessionFor(idToken()),
          scope: 'openid email profile',
          user,
        },
        updated_at: new Date().toISOString(),
      }
    }
    page = document.createElement('team-join')
    // (a device that is not this browser's, and a lookup that is not the default's, are given before it starts)
    page.device = { os: 'other', inAppBrowser: null }
    configure(page)
    page.fragment = fragment
    page.show = () => {
      shown++
    }
    page.syncSpace = async space => {
      synced.push(space.name)
      if (syncFails) throw new Error('Drive is not answering')
    }
    document.body.append(page)
    await page.updateComplete
  }

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    before = getCurrentSpace()
    shown = 0
    synced = []
    syncFails = false
    requested = []
    codeResponse = { code: 'the-code' }
    signInAnswer = () =>
      Response.json({
        blob: 'new-blob',
        access_token: 'tok',
        expires_in: 3600,
        id_token: idToken(),
        session: { access_token: idToken(), refresh_token: 'id.secret', expires_in: 900 },
        scope: 'openid email profile',
        user,
      })
    routes = {
      // (an invite for the address of the account signed in, which Google does not say is its own)
      'POST /api/spaces/invite': () =>
        Response.json({
          teamName: 'Pat Church',
          role: 'writer',
          email: 'bea@example.com',
          google: 'other',
        }),
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

  /** Say whether they have a Google account (the page asks, on a device that does not say) */
  /** The sign-in form the page shows (docs/ACCOUNT.md, "Signing in"), and Continue with Google on it */
  const form = () => must(page.shadowRoot?.querySelector('sign-in-form')) as SignInForm
  const formText = () => (form().shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
  const googleButton = () =>
    must(form().shadowRoot?.querySelector<HTMLButtonElement>('button.google'))
  /** Wait for the page to ask them to sign in */
  const askedToSignIn = () =>
    until(() => page.shadowRoot?.querySelector('sign-in-form'), 'the sign-in')

  it('asks them to sign in, with Google asking for Drive too, and then offers to join as who they are', async () => {
    await open(LINK, false)
    await until(
      () => text().includes('You are invited to join Pat Church as a worship leader.'),
      'the welcome'
    )
    await askedToSignIn()
    expect(text()).to.contain('Sign in to join')
    expect(text()).to.not.contain('Do you already have a Google account?')
    expect(form().address).to.equal('bea@example.com')

    googleButton().click()
    await until(() => text().includes('You are signed in as'), 'to be signed in')
    expect(requested).to.include(
      'ASK https://www.googleapis.com/auth/drive.file openid email profile'
    )
    expect(text()).to.contain('bea@example.com')
    expect(text()).to.contain('Join the team space')
    expect(requested).to.not.include('POST /api/spaces/join')
  })

  it('offers an emailed code on the same form, and then offers to join as who they signed in as', async () => {
    await open(LINK, false)
    await askedToSignIn()
    const code = must(form().shadowRoot?.querySelector('email-code-sign-in')) as unknown as {
      address: string
      start: (to: string) => Promise<void>
      verify: (to: string, code: string) => Promise<void>
    }
    expect(code.address).to.equal('bea@example.com')
    code.start = async () => {}
    code.verify = async () => {
      worker.stored = {
        blob: '',
        metadata: { scope: '', session: sessionFor('a'), user },
        updated_at: new Date().toISOString(),
      }
    }
    const root = must(code as unknown as Element).shadowRoot as ShadowRoot
    must(root.querySelector('form')).requestSubmit()
    await until(() => root.querySelector('input[name=code]') !== null, 'the code box')
    must(root.querySelector<HTMLInputElement>('input[name=code]')).value = '123456'
    must(root.querySelector('form')).requestSubmit()
    await until(() => text().includes('You are signed in as'), 'to be signed in')
    expect(text()).to.contain('Join the team space')
    expect(requested).to.not.include('POST /api/spaces/join')
  })

  it('shows Google only while the address is asked for, not while the code is', async () => {
    await open(LINK, false)
    await askedToSignIn()
    const code = must(form().shadowRoot?.querySelector('email-code-sign-in')) as unknown as {
      start: (to: string) => Promise<void>
    }
    code.start = async () => {}
    expect(form().shadowRoot?.querySelector('button.google')).to.not.equal(null)
    const root = must(code as unknown as Element).shadowRoot as ShadowRoot
    must(root.querySelector('form')).requestSubmit()
    await until(() => form().shadowRoot?.querySelector('button.google') === null, 'Google to go')
  })

  it('offers to join as who is signed in already, and joins when told to', async () => {
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    expect(text()).to.contain('bea@example.com')
    expect(requested).to.not.include('POST /api/spaces/join')

    button('Join the team space').click()
    await until(() => text().includes('You have joined'), 'to be joined')
    expect(text()).to.contain('as a worship leader')
    expect(text()).to.contain("The team's songs and setlists are here")
    expect(synced).to.have.length(1)
    expect(requested).to.include('POST /api/spaces/join')
    expect((await listSpaces()).some(space => space.team?.id === TEAM)).to.equal(true)
  })

  it('makes the team the space in use', async () => {
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    button('Join the team space').click()
    await until(() => text().includes('You have joined'), 'to be joined')
    const team = must((await listSpaces()).find(space => space.team?.id === TEAM))
    expect(getCurrentSpace().id).to.equal(team.id)
  })

  it('does not offer to bring in what a personal space holds, and leaves it alone', async () => {
    // (it did, and one press put a whole personal library into a team: docs/SPACES.md, "Joining by invite")
    const personal = await createSpace(`Pat Church personal ${crypto.randomUUID().slice(0, 8)}`)
    const db = new ChordlessDB(personal.id)
    await db.init()
    await addChart(db, '{title: Alpha}\n{key: G}\n[G]Alpha line', {
      variantLabel: 'Test',
      importSource: 'test',
      makeDefault: 'first',
    })
    await db.saveSetlist(makeSetlist({ id: 'pat-set', date: '2026-12-06' }))
    db.db?.close()

    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    button('Join the team space').click()
    await until(() => text().includes('You have joined'), 'to be joined')
    expect(text()).to.not.contain('Bring')
    expect(text()).to.not.contain('Not now')

    const team = must((await listSpaces()).find(space => space.team?.id === TEAM))
    const teamDb = new ChordlessDB(team.id)
    await teamDb.init()
    expect(await teamDb.getAllSetlists()).to.deep.equal([])
    expect(await teamDb.getAllSongs()).to.deep.equal([])
    teamDb.db?.close()
  })

  it('shows how far the first sync has got while it runs, and the bar goes when it is done', async () => {
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    let release = () => {}
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    let report: ProgressCallback | undefined
    page.syncSpace = async (_space, onProgress) => {
      report = onProgress
      await held
    }
    button('Join the team space').click()
    await until(() => text().includes("Getting the team's songs and setlists"), 'syncing')
    const bar = () => must(page.shadowRoot?.querySelector('progress-bar'))
    expect(bar().total, 'it does not know how far yet').to.equal(undefined)

    must(report)({ stage: 'pulling', message: 'Downloaded 20/80 songs', current: 20, total: 80 })
    await until(() => text().includes('Downloaded 20/80 songs'), 'the progress')
    expect([bar().current, bar().total]).to.deep.equal([20, 80])

    release()
    await until(() => text().includes('You have joined'), 'to be joined')
    expect(page.shadowRoot?.querySelector('progress-bar')).to.equal(null)
  })

  it('joins all the same when the first sync does not work, and offers to try again', async () => {
    syncFails = true
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    button('Join the team space').click()
    await until(() => text().includes('You have joined'), 'to be joined')
    expect(text()).to.contain('have not come across yet')
    expect(text()).to.contain("Couldn't get the team's songs and setlists.")
    expect(text()).to.not.contain('Drive is not answering')

    syncFails = false
    button('Try again').click()
    await until(() => text().includes("The team's songs and setlists are here"), 'synced')
    expect(synced).to.have.length(2)
  })

  it('works when the sign-in has no profile to show: it does not say who they are', async () => {
    worker.stored = {
      blob: 'blob',
      metadata: {
        access_token: 'token',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        id_token: idToken(),
        session: sessionFor(idToken()),
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

  it('takes the invite from the path of the link, and another when the route changes', async () => {
    await open('', true)
    page.route = { name: 'join', teamId: TEAM, code: CODE }
    await until(() => text().includes('Join the team space'), 'the offer')
    expect(page._invite).to.deep.equal({ teamId: TEAM, code: CODE })

    page.route = { name: 'join', teamId: 'space-bbbb2222', code: 'zyxwvutsrqponmlk' }
    await until(() => page._invite?.teamId === 'space-bbbb2222', 'the second link')
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
      await until(() => text().includes('Sign in to join'), 'the new link to be read')
    } finally {
      window.location.hash = original
    }

    page.remove()
    offerLink('/join', '#cut-short')
    await nothingFor(50)
    expect(takeLink('/join')).to.equal('#cut-short')
  })

  it('opens the space it joined, starting the app afresh', async () => {
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    button('Join the team space').click()
    await until(() => text().includes('You have joined'), 'to be joined')

    button('Open Pat Church').click()
    await until(() => shown === 1, 'the space to be shown')
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
    await until(() => text().includes('Sign in to join'), 'the sign-in')
    expect(worker.stored, 'signed out of the account that was refused').to.equal(undefined)
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
    // (the Worker failing is not for them to read: they are told what could not be done)
    expect(text()).to.contain("Couldn't join the team space.")
    expect(text()).to.not.contain('Error 500')

    button('Try again').click()
    await until(() => text().includes('Join the team space'), 'the offer again')
  })

  it('asks them to sign in again when Google no longer honours the sign-in', async () => {
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    // (the access token is good, there is no session, and the blob is no longer readable)
    const stored = must(worker.stored)
    worker.stored = { ...stored, metadata: { ...stored.metadata, session: undefined } }
    routes['POST /session/upgrade'] = () =>
      Response.json({ error: 'invalid_blob' }, { status: 401 })
    window.fetch = ((original: typeof fetch) =>
      (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === '/session/upgrade'
          ? Response.json({ error: 'invalid_blob' }, { status: 401 })
          : original(input, init)) as typeof fetch)(window.fetch)

    button('Join the team space').click()
    await until(() => text().includes('Sign in to join'), 'the sign-in again')
  })

  it('says so when the sign-in window gives nothing', async () => {
    codeResponse = { error: 'access_denied' }
    await open(LINK, false)
    await askedToSignIn()
    googleButton().click()
    await until(() => formText().includes('Signing in failed'), 'the failure')
    expect(formText()).to.not.contain('access_denied')
    expect(text()).to.contain('Sign in to join')
  })

  /** What the Worker says the invite is for: the default is an address of the person signed in, which Google does not say is its own */
  const inviteFor = (over: Record<string, unknown>) => {
    routes['POST /api/spaces/invite'] = () =>
      Response.json({
        teamName: 'Pat Church',
        role: 'writer',
        email: 'bea@example.com',
        google: 'other',
        ...over,
      })
  }

  it('says an invite for an admin is for its address alone, and offers no way to join as another', async () => {
    inviteFor({ role: 'admin', email: 'boss@example.com' })
    await open()
    await until(() => text().includes('You are signed in as'), 'to be signed in')
    expect(text()).to.contain('can only be used with the address it was sent to: boss@example.com')
    expect(
      Array.from(page.shadowRoot?.querySelectorAll('button') ?? []).map(each =>
        each.textContent?.trim()
      )
    ).to.deep.equal(['Use a different account'])
    expect(requested).to.not.include('POST /api/spaces/join')
  })

  it('lets someone join an admin invite with the address it was sent to', async () => {
    inviteFor({ role: 'admin', email: 'BEA@Example.com' })
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    expect(text()).to.not.contain('can only be used')
    button('Join the team space').click()
    await until(() => text().includes('You have joined'), 'to be joined')
  })

  it('says it is joining with another address than the one invited, and joins', async () => {
    inviteFor({ email: 'bea@hotmail.example' })
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    expect(text()).to.contain(
      'This invite was sent to bea@hotmail.example, and you are signed in as bea@example.com.'
    )
    button('Join the team space').click()
    await until(() => text().includes('You have joined'), 'to be joined')
  })

  it('asks for the page to be opened in the browser when it is inside another app’s, and can carry on', async () => {
    const copied: string[] = []
    await open(LINK, false, current => {
      current.device = { os: 'ios', inAppBrowser: 'Facebook' }
      current.copyText = async text => void copied.push(text)
    })
    await until(() => text().includes('Open this page in your browser'), 'the advice')
    expect(text()).to.contain('inside Facebook')
    button('Copy link').click()
    await until(() => text().includes('Link copied'), 'the link to be copied')
    expect(copied).to.deep.equal([window.location.href])

    button('Continue here anyway').click()
    await until(() => text().includes('Sign in to join'), 'the sign-in')
  })

  it('welcomes without the details when the invite cannot be looked up, and says one that is no good is not', async () => {
    routes['POST /api/spaces/invite'] = () => Response.json({ error: 'busy' }, { status: 429 })
    await open(LINK, false)
    await until(
      () => text().includes('You have been invited to join a team on Chordless.'),
      'the welcome'
    )
    await until(() => text().includes('Sign in to join'), 'the sign-in')

    page.remove()
    routes['POST /api/spaces/invite'] = () => Response.json({ error: 'no' }, { status: 404 })
    await open(LINK, false)
    await until(() => text().includes("This invite doesn't work"), 'the refusal')
    expect(text()).to.contain('It may have been used, withdrawn or have run out')
  })

  it('asks an expired sign-in to be made again', async () => {
    worker.stored = {
      blob: 'blob',
      metadata: {
        access_token: 'token',
        expires_at: new Date(Date.now() - 3600_000).toISOString(),
        id_token: idToken(-60),
        scope: 'openid email profile',
        user,
      },
      updated_at: new Date().toISOString(),
    }
    routes['POST /session/refresh'] = () =>
      Response.json({ error: 'invalid_grant' }, { status: 401 })
    await open(LINK, false)
    await until(() => text().includes('Sign in to join'), 'the sign-in')
  })

  it('says an admin invite is for its address before they have signed in, and what to do when the sign-in fails', async () => {
    inviteFor({ role: 'admin', email: 'boss@example.com' })
    codeResponse = { error: 'access_denied' }
    await open(LINK, false)
    await until(
      () => text().includes('can only be used with the address it was sent to: boss@example.com'),
      'the sign-in'
    )
    googleButton().click()
    await until(() => formText().includes('Signing in failed'), 'the failure')
    expect(text()).to.contain('can only be used with the address it was sent to: boss@example.com')
  })

  it('has nothing to say of the address when the invite could not be looked up, signed in', async () => {
    routes['POST /api/spaces/invite'] = () => Response.json({ error: 'busy' }, { status: 429 })
    await open()
    await until(() => text().includes('Join the team space'), 'the offer')
    expect(text()).to.not.contain('This invite was sent to')
  })

  it('carries on when the link cannot be copied', async () => {
    await open(LINK, false, current => {
      current.device = { os: 'ios', inAppBrowser: 'Instagram' }
      current.copyText = async () => {
        throw new Error('not allowed')
      }
    })
    await until(() => text().includes('Open this page in your browser'), 'the advice')
    button('Copy link').click()
    await nothingFor(50)
    expect(text()).to.contain('Copy link')
    expect(text()).to.not.contain('Link copied')
  })

  it('copies the link with the browser’s clipboard unless told otherwise', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    })
    try {
      await open(LINK, false, current => {
        current.device = { os: 'ios', inAppBrowser: 'Facebook' }
      })
      await until(() => text().includes('Open this page in your browser'), 'the advice')
      button('Copy link').click()
      await until(() => text().includes('Link copied'), 'copied')
      expect(written).to.deep.equal([window.location.href])
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  describe('where it leaves a trace of how it went', () => {
    const exporter = new InMemorySpanExporter()
    beforeEach(() => {
      setTelemetryPreference(true)
      trace.disable()
      trace.setGlobalTracerProvider(
        new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] })
      )
      exporter.reset()
    })
    afterEach(() => {
      trace.disable()
      setTelemetryPreference(false)
    })
    const joinSpans = () =>
      exporter.getFinishedSpans().filter(span => span.name === 'chordless.join')

    it('says how a join went: the steps, what was known of the invite, and that they were the invited address', async () => {
      await open()
      await until(() => text().includes('Join the team space'), 'the offer')
      button('Join the team space').click()
      await until(() => text().includes('You have joined'), 'to be joined')
      page.remove()

      expect(joinSpans()).to.have.length(1)
      const { attributes } = joinSpans()[0]
      expect(attributes['chordless.join.outcome']).to.equal('joined')
      expect(attributes['chordless.join.steps']).to.equal('checking,ready,joining,syncing,joined')
      expect(attributes['chordless.join.last_step']).to.equal('joined')
      expect(attributes['chordless.join.role']).to.equal('writer')
      expect(attributes['chordless.join.invite_google']).to.equal('other')
      expect(attributes['chordless.join.in_app_browser']).to.equal('none')
      expect(attributes['chordless.join.signed_in_as_invited']).to.equal(true)
      expect(attributes['chordless.join.ms']).to.be.a('number')
      expect(JSON.stringify(attributes)).to.not.contain('example.com')
    })

    it('says where they stopped when they leave without joining', async () => {
      await open(LINK, false)
      await askedToSignIn()
      page.remove()

      const { attributes } = joinSpans()[0]
      expect(attributes['chordless.join.outcome']).to.equal('abandoned')
      expect(attributes['chordless.join.last_step']).to.equal('sign-in')
    })

    it('says an admin invite was not used with its address, and a link that is no good', async () => {
      inviteFor({ role: 'admin', email: 'boss@example.com' })
      await open()
      await until(() => text().includes('can only be used'), 'the lock')
      page.remove()
      expect(joinSpans()[0].attributes['chordless.join.outcome']).to.equal('needs_admin_address')

      exporter.reset()
      await open('#cut-short', false)
      expect(joinSpans()[0].attributes['chordless.join.outcome']).to.equal('bad_link')
    })

    it('makes one span for a visit however it ends', async () => {
      routes['POST /api/spaces/invite'] = () => Response.json({}, { status: 404 })
      await open(LINK, false)
      await until(() => text().includes("This invite doesn't work"), 'the refusal')
      page.remove()
      expect(joinSpans()).to.have.length(1)
      expect(joinSpans()[0].attributes['chordless.join.outcome']).to.equal('not_valid')
    })
  })
})
