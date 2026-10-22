/**
 * The page that makes a team space (team-space-wizard.ts): signing in with Drive, a name and a
 * folder, and what is said when the Worker refuses. The Worker is a fetch that answers from a
 * table, Google's sign-in window a stub, the folder chooser and Drive's folder call given in, and
 * the service worker that keeps the sign-in a fake one.
 */
import { expect } from '@open-wc/testing'
import '../src/components/team-space-wizard.ts'
import type { TeamSpaceWizard } from '../src/components/team-space-wizard.ts'
import { deleteSpace, getCurrentSpace, listSpaces, setCurrentSpace } from '../src/js/space.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const idToken = () =>
  `${encode({ alg: 'RS256' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
const DRIVE = 'https://www.googleapis.com/auth/drive.file'
const user = {
  name: 'Bea Singer',
  email: 'bea@example.com',
  picture: null,
  given_name: null,
  family_name: null,
  sub: '1',
}

describe('team-space-wizard', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  const realGoogle = (window as { google?: unknown }).google
  let requests: { key: string; body?: unknown }[]
  let workerAnswer: () => Response
  let asked: string[]
  let codeResponse: { code?: string; error?: string }
  let page: TeamSpaceWizard
  let reloads: number
  let madeFolders: [string, string][]
  let before: { id: string | null; name: string }
  const prefix = 'Wizard Church'

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
  const type = async (name: string) => {
    const input = must(page.shadowRoot?.querySelector<HTMLInputElement>('#name'))
    input.value = name
    input.dispatchEvent(new Event('input'))
    await page.updateComplete
  }

  async function open(scope: string | null = `${DRIVE} openid email profile`, ownPick = true) {
    if (scope) {
      worker.stored = {
        blob: 'blob',
        metadata: {
          access_token: 'token',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          id_token: idToken(),
          scope,
          user,
        },
        updated_at: new Date().toISOString(),
      }
    }
    page = document.createElement('team-space-wizard')
    page.reload = () => {
      reloads++
    }
    if (ownPick) page.pick = async () => ({ id: 'picked', name: 'Church Drive' })
    page.folders = {
      createTeamFolder: async (parentId, name) => {
        madeFolders.push([parentId, name])
        return 'new-folder'
      },
    }
    document.body.append(page)
    await page.updateComplete
  }

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    before = getCurrentSpace()
    reloads = 0
    requests = []
    asked = []
    codeResponse = { code: 'the-code' }
    madeFolders = []
    workerAnswer = () => Response.json({ spaceId: 'space-dddd4444', role: 'owner' })
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      const key = `${init?.method ?? 'GET'} ${path}`
      requests.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (path === '/oauth/callback') {
        return Response.json({
          blob: 'new-blob',
          access_token: 'tok',
          expires_in: 3600,
          id_token: idToken(),
          scope: `${DRIVE} openid email profile`,
          user,
        })
      }
      if (key === 'POST /api/spaces') return workerAnswer()
      return Response.json({ error: 'no such route' }, { status: 404 })
    }) as typeof fetch
    ;(window as { google?: unknown }).google = {
      accounts: {
        oauth2: {
          initCodeClient: (config: { scope: string; callback: (response: object) => void }) => ({
            requestCode: () => {
              asked.push(config.scope)
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
    for (const space of await listSpaces()) {
      if (space.name.startsWith(prefix)) await deleteSpace(space.id)
    }
    if (before.id) await setCurrentSpace(before.id, before.name)
  })

  it('asks to sign in with Drive first, then shows the form', async () => {
    await open(null)
    await until(() => text().includes('Sign in with Google'), 'asks to sign in')
    button('Sign in with Google').click()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    expect(asked).to.have.length(1)
    expect(asked[0]).to.contain(DRIVE)
  })

  it('asks to connect Drive for someone signed in without it', async () => {
    await open('openid email profile')
    await until(() => text().includes('Connect Google Drive'), 'asks to connect Drive')
    button('Connect Google Drive').click()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    expect(asked).to.deep.equal([DRIVE])
  })

  it('makes the space once it has a name and a folder, and opens it on request', async () => {
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    expect(button('Create team space').disabled).to.equal(true)

    const name = `${prefix} ${crypto.randomUUID().slice(0, 8)}`
    await type(name)
    expect(button('Create team space').disabled, 'no folder yet').to.equal(true)
    button('Choose a folder').click()
    await until(() => text().includes('Church Drive'), 'the folder is shown')
    expect(button('Create team space').disabled).to.equal(false)

    button('Create team space').click()
    await until(() => text().includes('is ready'), 'created')
    expect(madeFolders).to.deep.equal([['picked', name]])
    const post = must(requests.find(request => request.key === 'POST /api/spaces'))
    expect(post.body).to.deep.equal({ blob: 'blob', rootRef: 'new-folder', name })
    const made = must((await listSpaces()).find(space => space.name === name))
    expect(made.team).to.deep.equal({ id: 'space-dddd4444', role: 'owner' })

    button('Open').click()
    await until(() => reloads === 1, 'starts the app afresh')
    expect(getCurrentSpace().id).to.equal(made.id)
  })

  it('says what the Worker said, and leaves the form to try again', async () => {
    workerAnswer = () => Response.json({ error: 'Not allowed' }, { status: 403 })
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    await type(`${prefix} refused`)
    button('Choose a folder').click()
    await until(() => text().includes('Church Drive'), 'the folder is shown')
    button('Create team space').click()
    await until(() => text().includes('Not allowed'), 'says why')
    expect(button('Create team space').disabled).to.equal(false)
    expect((await listSpaces()).some(space => space.name === `${prefix} refused`)).to.equal(false)
  })

  it('says why the folder could not be chosen, and keeps the one it had', async () => {
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    button('Choose a folder').click()
    await until(() => text().includes('Church Drive'), 'the folder is shown')
    page.pick = async () => {
      throw new Error('The folder picker is not set up on this server')
    }
    button('Choose a different folder').click()
    await until(() => text().includes('not set up'), 'says why')
    expect(text()).to.contain('Church Drive')
  })

  it('says why signing in did not work, and offers it again', async () => {
    codeResponse = { error: 'access_denied' }
    await open(null)
    await until(() => text().includes('Sign in with Google'), 'asks to sign in')
    button('Sign in with Google').click()
    await until(() => page.shadowRoot?.querySelector('.error'), 'says why')
    expect(text()).to.contain('Sign in with Google')
    expect(page.shadowRoot?.querySelector('#name')).to.equal(null)
  })

  it('makes nothing without a name and a folder, whatever is sent to it', async () => {
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    await page._create()
    expect(requests.some(request => request.key === 'POST /api/spaces')).to.equal(false)
    expect(madeFolders).to.deep.equal([])
  })

  it('uses the real folder picker unless given another, which says when the server has no key', async () => {
    await open(undefined, false)
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    button('Choose a folder').click()
    await until(() => page.shadowRoot?.querySelector('.error'), 'says why')
    expect(text()).to.contain('not set up')
  })

  it('keeps the folder it had when they cancel choosing another', async () => {
    await open()
    await until(() => page.shadowRoot?.querySelector('#name'), 'the form')
    button('Choose a folder').click()
    await until(() => text().includes('Church Drive'), 'the folder is shown')
    page.pick = async () => null
    button('Choose a different folder').click()
    await wait(50)
    expect(text()).to.contain('Church Drive')
    expect(page.shadowRoot?.querySelector('.error')).to.equal(null)
  })
})
