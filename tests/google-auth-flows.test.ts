/**
 * Signing in: loading Google's script, the code client, the exchange at the Worker, and what is
 * kept. (Tokens and the stored user are in google-auth.test.ts.)
 */
import { expect } from '@open-wc/testing'
import {
  authorizeWithGoogle,
  downloadBlobBackup,
  getCurrentUserInfo,
  getIdToken,
  getPendingOperations,
  importBlobBackup,
  initGoogleAuth,
  listenForIdTokenRequests,
  processQueue,
  queueInvite,
  queueRevoke,
} from '../src/js/google-auth.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { suppressConsoleLogs, wait } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

type CodeConfig = { callback: (response: { code?: string; error?: string }) => void }
type PromptNotification = {
  isNotDisplayed(): boolean
  isSkippedMoment(): boolean
  isDismissedMoment(): boolean
  getDismissedReason(): string
}
/** What Google tells of a prompt, apart from what a test changes */
const shown: PromptNotification = {
  isNotDisplayed: () => false,
  isSkippedMoment: () => false,
  isDismissedMoment: () => false,
  getDismissedReason: () => '',
}

describe('google-auth: signing in', () => {
  let worker: FakeAuthWorker
  let uninstall: () => void
  const realFetch = window.fetch
  const realGoogle = (window as { google?: unknown }).google
  let fetches: Array<{ url: string; body?: Record<string, unknown> }>
  let respondTo: (url: string) => Response | Promise<Response>
  let codeResponse: { code?: string; error?: string }
  let idCredential: string | null
  let promptNotification: PromptNotification | null
  /** The credential comes first, then the notification (the prompt closing after it) */
  let credentialFirst: boolean

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
    idCredential = 'id-credential'
    promptNotification = null
    credentialFirst = false
    ;(window as { google?: unknown }).google = {
      accounts: {
        oauth2: {
          initCodeClient: (config: CodeConfig) => ({
            requestCode: () => config.callback(codeResponse),
          }),
        },
        id: {
          initialize: (config: { callback: (response: { credential?: string }) => void }) => {
            ;(window as unknown as { __idCallback: typeof config.callback }).__idCallback =
              config.callback
          },
          prompt: (callback: (notification: PromptNotification) => void) => {
            const callbackInit = (
              window as unknown as {
                __idCallback: (response: { credential?: string }) => void
              }
            ).__idCallback
            if (promptNotification && credentialFirst) {
              callbackInit({ credential: idCredential ?? undefined })
            }
            if (promptNotification) callback(promptNotification)
            else callbackInit({ credential: idCredential ?? undefined })
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

  describe('the ID token', () => {
    it('is the credential Google gives', async () => {
      expect(await getIdToken()).to.equal('id-credential')
    })

    it('is not there when Google gives none', async () => {
      idCredential = null
      let message = ''
      try {
        await getIdToken()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.equal('No ID token received')
    })

    it('is not there when Google does not show its prompt', async () => {
      promptNotification = { ...shown, isNotDisplayed: () => true }
      let message = ''
      try {
        await getIdToken()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.equal('ID token not available')
    })

    it('is not there when Google skips its prompt', async () => {
      promptNotification = { ...shown, isSkippedMoment: () => true }
      let message = ''
      try {
        await getIdToken()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.equal('ID token not available')
    })

    it('is not there when the prompt is closed without a credential', async () => {
      idCredential = null
      promptNotification = {
        ...shown,
        isDismissedMoment: () => true,
        getDismissedReason: () => 'cancel_called',
      }
      let message = ''
      try {
        await getIdToken()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).to.equal('ID token not available')
    })

    it('is the credential even though the prompt closes after giving it', async () => {
      credentialFirst = true
      promptNotification = {
        ...shown,
        isDismissedMoment: () => true,
        getDismissedReason: () => 'credential_returned',
      }
      expect(await getIdToken()).to.equal('id-credential')
    })

    describe('asked for by the service worker', () => {
      let listening = false
      const ask = () =>
        new Promise<unknown>(resolve => {
          const channel = new MessageChannel()
          channel.port1.onmessage = event => resolve(event.data)
          navigator.serviceWorker.dispatchEvent(
            new MessageEvent('message', {
              data: { type: 'REQUEST_ID_TOKEN' },
              ports: [channel.port2],
            })
          )
        })

      beforeEach(() => {
        if (!listening) {
          listenForIdTokenRequests()
          listening = true
        }
      })

      it('is given', async () => {
        expect(await ask()).to.deep.equal({ idToken: 'id-credential' })
      })

      it('is said to be missing when it cannot be had', async () => {
        idCredential = null
        expect(await ask()).to.deep.equal({ idToken: null })
      })

      it('ignores other messages', async () => {
        navigator.serviceWorker.dispatchEvent(
          new MessageEvent('message', { data: { type: 'OTHER' } })
        )
      })
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

  describe('the queue of Drive operations', () => {
    it('takes invites and revokes, lists them, and is told to process them', async () => {
      expect((await queueInvite('f1', 'a@example.com')).success).to.equal(true)
      expect((await queueRevoke('f1', 'p1')).success).to.equal(true)
      const operations = await getPendingOperations()
      expect(operations).to.have.length(2)
      await processQueue()
    })

    it('lists none when the worker has no list', async () => {
      worker.queued = undefined as never
      expect(await getPendingOperations()).to.deep.equal([])
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
