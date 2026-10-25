/**
 * Signing in: loading Google's script, the code client, the exchange at the Worker, and what is
 * kept. (Tokens and the stored user are in google-auth.test.ts.)
 */
import { expect } from '@open-wc/testing'
import {
  authorizeWithGoogle,
  connectDrive,
  downloadBlobBackup,
  getCurrentUserInfo,
  hasDriveAccess,
  importBlobBackup,
  initGoogleAuth,
} from '../src/js/google-auth.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

type CodeConfig = {
  scope: string
  prompt?: string
  include_granted_scopes?: boolean
  callback: (response: { code?: string; error?: string }) => void
}

describe('google-auth: signing in', () => {
  let worker: FakeAuthWorker
  let uninstall: () => void
  const realFetch = window.fetch
  const realGoogle = (window as { google?: unknown }).google
  let fetches: Array<{ url: string; body?: Record<string, unknown> }>
  let respondTo: (url: string) => Response | Promise<Response>
  let codeResponse: { code?: string; error?: string }
  /** What the page last asked Google for */
  let requested: CodeConfig | undefined

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  beforeEach(() => {
    const installed = installFakeAuthWorker()
    worker = installed.worker
    uninstall = installed.uninstall
    fetches = []
    respondTo = () => json({ blob: 'b', access_token: 'tok', expires_in: 3600, user: null })
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      fetches.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return respondTo(url)
    }) as typeof fetch
    codeResponse = { code: 'the-code' }
    ;(window as { google?: unknown }).google = {
      accounts: {
        oauth2: {
          initCodeClient: (config: CodeConfig) => {
            requested = config
            return { requestCode: () => config.callback(codeResponse) }
          },
        },
      },
    }
  })

  afterEach(() => {
    window.fetch = realFetch
    ;(window as { google?: unknown }).google = realGoogle
    uninstall()
  })

  describe('loading Google’s sign-in script', () => {
    it('does nothing when it is there already', async () => {
      await initGoogleAuth()
      expect(document.querySelector('script[src*="accounts.google.com"]')).to.equal(null)
    })

    it('adds the script, and is ready when it has loaded', async () => {
      ;(window as { google?: unknown }).google = undefined
      const realAppend = document.head.appendChild.bind(document.head)
      let added: HTMLScriptElement | null = null
      document.head.appendChild = ((node: Node) => {
        added = node as HTMLScriptElement
        return node
      }) as typeof document.head.appendChild
      try {
        const loaded = initGoogleAuth()
        expect((added as HTMLScriptElement | null)?.src).to.equal(
          'https://accounts.google.com/gsi/client'
        )
        ;(added as unknown as HTMLScriptElement).onload?.(new Event('load'))
        await loaded
      } finally {
        document.head.appendChild = realAppend
      }
    })

    it('says so, and removes the script, when it cannot be loaded', async () => {
      ;(window as { google?: unknown }).google = undefined
      const realAppend = document.head.appendChild.bind(document.head)
      let added: HTMLScriptElement | null = null
      document.head.appendChild = ((node: Node) => {
        added = node as HTMLScriptElement
        realAppend(node)
        return node
      }) as typeof document.head.appendChild
      try {
        const loading = initGoogleAuth()
        ;(added as unknown as HTMLScriptElement).onerror?.(new Event('error'))
        let message = ''
        try {
          await loading
        } catch (error) {
          message = (error as Error).message
        }
        expect(message).to.contain("Couldn't load Google sign-in")
        expect(document.querySelector('script[src*="accounts.google.com"]')).to.equal(null)
      } finally {
        document.head.appendChild = realAppend
      }
    })
  })

  describe('authorizing', () => {
    it('exchanges the code at the Worker, and keeps the blob, with the expiry and the ID token', async () => {
      respondTo = () =>
        json({ blob: 'blob-1', access_token: 'tok', expires_in: 3600, id_token: 'idt', user: null })
      const result = await authorizeWithGoogle()
      await wait(20)
      expect(fetches[0].url).to.equal('/oauth/callback')
      expect(fetches[0].body).to.deep.equal({
        code: 'the-code',
        redirect_uri: window.location.origin,
      })
      expect(result).to.include({ blob: 'blob-1', access_token: 'tok' })
      expect(worker.stored?.blob).to.equal('blob-1')
      expect(worker.stored?.metadata.id_token).to.equal('idt')
      expect(new Date(worker.stored?.metadata.expires_at ?? 0).getTime()).to.be.greaterThan(
        Date.now()
      )
    })

    it('keeps no ID token when the Worker gives none', async () => {
      await authorizeWithGoogle()
      expect(worker.stored?.metadata).to.not.have.property('id_token')
    })

    it('keeps the user it is told of, with their picture for offline', async () => {
      const user = { name: 'Ann', email: 'ann@example.com', picture: 'https://pics.test/ann.png' }
      respondTo = url =>
        url.endsWith('ann.png')
          ? new Response(new Blob(['png'], { type: 'image/png' }))
          : json({ blob: 'b', access_token: 't', expires_in: 60, user })
      const result = await authorizeWithGoogle()
      expect(result.user?.name).to.equal('Ann')
      expect(worker.stored?.metadata.user?.avatarDataUrl).to.match(/^data:/)
    })

    it('keeps the user even when the picture cannot be read', async () => {
      const user = { name: 'Ann', email: 'ann@example.com', picture: 'https://pics.test/ann.png' }
      respondTo = url =>
        url.endsWith('ann.png')
          ? new Response('', { status: 404 })
          : json({ blob: 'b', access_token: 't', expires_in: 60, user })
      const result = await authorizeWithGoogle()
      expect(result.user?.name).to.equal('Ann')
      expect(worker.stored?.metadata.user?.avatarDataUrl).to.equal(undefined)
    })

    it('fails with what Google says went wrong', async () => {
      codeResponse = { error: 'access_denied' }
      let message = ''
      try {
        await authorizeWithGoogle()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.equal('access_denied')
      expect(worker.stored).to.equal(undefined)
    })

    it('fails with what the Worker says, or a reason of its own', async () => {
      respondTo = () => json({ error: 'Bad code' }, 400)
      let message = ''
      try {
        await authorizeWithGoogle()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.equal('Bad code')
      respondTo = () => json({}, 500)
      try {
        await authorizeWithGoogle()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.equal('Failed to exchange code for tokens')
    })

    const DRIVE = 'https://www.googleapis.com/auth/drive.file'
    const without = {
      blob: 'b',
      access_token: 'tok',
      expires_in: 3600,
      scope: 'openid email profile',
    }
    const withDrive = { ...without, scope: `${DRIVE} openid email profile` }

    it('asks for Drive with the sign-in, and for who they are alone when told not to', async () => {
      await authorizeWithGoogle()
      expect(requested?.scope).to.contain(DRIVE)
      expect(requested?.prompt).to.equal('consent')

      await authorizeWithGoogle({ drive: false })
      expect(requested?.scope).to.equal('openid email profile')
    })

    it('keeps what Google granted, and signs in without Drive if its box was left unticked', async () => {
      respondTo = () => json(without)
      await authorizeWithGoogle()
      expect(worker.stored?.metadata.scope).to.equal('openid email profile')
      expect(await hasDriveAccess()).to.equal(false)

      respondTo = () => json(withDrive)
      await authorizeWithGoogle()
      expect(await hasDriveAccess()).to.equal(true)
    })

    it('adds Drive to a sign-in without it: Drive alone, keeping what was granted, replacing the sign-in', async () => {
      respondTo = () => json(without)
      await authorizeWithGoogle({ drive: false })
      expect(await hasDriveAccess()).to.equal(false)

      respondTo = () => json({ ...withDrive, blob: 'second-blob' })
      await connectDrive()
      expect(requested?.scope).to.equal(DRIVE)
      expect(requested?.include_granted_scopes).to.equal(true)
      expect(requested?.prompt).to.equal('consent')
      expect(worker.stored?.blob).to.equal('second-blob')
      expect(await hasDriveAccess()).to.equal(true)
    })

    it('says so when Google or the worker refuses to add Drive, and keeps the sign-in it has', async () => {
      respondTo = () => json(without)
      await authorizeWithGoogle({ drive: false })
      codeResponse = { error: 'access_denied' }
      let message = ''
      await connectDrive().catch(error => {
        message = error.message
      })
      expect(message).to.equal('access_denied')
      expect(worker.stored?.blob).to.equal('b')
    })

    it('counts a sign-in made before the scope was kept as having Drive, and none as not', async () => {
      expect(await hasDriveAccess()).to.equal(false)
      worker.stored = { blob: 'old', metadata: {}, updated_at: new Date().toISOString() }
      expect(await hasDriveAccess()).to.equal(true)
    })

    it('fails when the worker cannot keep the blob', async () => {
      worker.failing.add('STORE_BLOB')
      let message = ''
      try {
        await authorizeWithGoogle()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.equal('worker failed')
      expect(await getCurrentUserInfo()).to.equal(null)
    })
  })

  describe('the backup', () => {
    it('is imported through the worker', async () => {
      await importBlobBackup({ version: 1, blob: 'saved', metadata: {} })
      expect(worker.stored?.blob).to.equal('saved')
    })

    it('is downloaded as a file named by the day', async () => {
      worker.stored = { blob: 'b', metadata: {}, updated_at: 'now' }
      const clicked: string[] = []
      const realClick = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function () {
        clicked.push(this.download)
      }
      try {
        await downloadBlobBackup()
      } finally {
        HTMLAnchorElement.prototype.click = realClick
      }
      expect(clicked[0]).to.match(/^chordless-auth-backup-\d{4}-\d{2}-\d{2}\.json$/)
    })
  })

  describe('the user, from what is stored', () => {
    const idToken = (payload: object) => {
      const encode = (value: object) =>
        btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return `${encode({ alg: 'RS256' })}.${encode(payload)}.sig`
    }

    it('is worked out from an ID token that says only some things', async () => {
      worker.stored = {
        blob: 'b',
        metadata: { id_token: idToken({ email: 'a@example.com' }) },
        updated_at: 'now',
      }
      const user = await getCurrentUserInfo()
      expect(user?.email).to.equal('a@example.com')
      expect(user?.name).to.equal(null)
      expect(user?.picture).to.equal(null)
    })

    it('is worked out from an ID token with everything', async () => {
      worker.stored = {
        blob: 'b',
        metadata: {
          id_token: idToken({
            name: 'Ann Smith',
            email: 'a@example.com',
            given_name: 'Ann',
            family_name: 'Smith',
            sub: '1',
          }),
        },
        updated_at: 'now',
      }
      const user = await getCurrentUserInfo()
      expect([user?.givenName, user?.familyName]).to.deep.equal(['Ann', 'Smith'])
    })

    it('has no user without a blob, or with a blob that holds no one', async () => {
      expect(await getCurrentUserInfo()).to.equal(null)
      worker.stored = { blob: 'b', metadata: {}, updated_at: 'now' }
      expect(await getCurrentUserInfo()).to.equal(null)
    })

    it('shows the user without a picture cached when the picture cannot be read as data', async () => {
      worker.stored = {
        blob: 'b',
        metadata: {
          user: {
            name: 'Ann',
            email: 'a@example.com',
            picture: 'https://pics.test/a.png',
            given_name: null,
            family_name: null,
            sub: '1',
          },
        },
        updated_at: 'now',
      }
      respondTo = () => new Response(new Blob(['png'], { type: 'image/png' }))
      const realRead = FileReader.prototype.readAsDataURL
      FileReader.prototype.readAsDataURL = function () {
        this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
      }
      try {
        const user = await getCurrentUserInfo()
        expect(user?.name).to.equal('Ann')
        expect(user?.avatarDataUrl).to.equal(null)
      } finally {
        FileReader.prototype.readAsDataURL = realRead
      }
    })
  })

  describe('talking to the service worker', () => {
    it('takes no notice of an answer to another question', async () => {
      const real = Object.getOwnPropertyDescriptor(navigator.serviceWorker, 'controller')
      Object.defineProperty(navigator.serviceWorker, 'controller', {
        configurable: true,
        get: () => ({
          postMessage: (message: { messageId: string }, [port]: MessagePort[]) => {
            port.postMessage({
              messageId: 'someone-elses',
              success: true,
              data: { blob: 'wrong', metadata: {} },
            })
            port.postMessage({
              messageId: message.messageId,
              success: true,
              data: { blob: 'right', metadata: { user: { name: 'Ann', email: 'a@example.com' } } },
            })
          },
        }),
      })
      try {
        const user = await getCurrentUserInfo()
        expect(user?.name).to.equal('Ann')
      } finally {
        if (real) Object.defineProperty(navigator.serviceWorker, 'controller', real)
      }
    })
  })
})
