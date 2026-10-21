import { expect } from '@open-wc/testing'
import type { AuthMetadata, StoredUser } from '../src/js/auth-db.ts'
import {
  exportBlobBackup,
  getAccessToken,
  getCurrentUserInfo,
  getIdentityToken,
  getSignInState,
  hasDriveAccess,
  isAuthenticated,
  logout,
  SignInExpiredError,
} from '../src/js/google-auth.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

/** An ID token with this payload (the signature is never checked by the page) */
const idToken = (payload: object) => {
  const encode = (value: object) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`
}

const makeUser = (over: Partial<StoredUser> = {}): StoredUser => ({
  name: 'Ann',
  email: 'ann@example.com',
  picture: null,
  given_name: null,
  family_name: null,
  sub: '1',
  ...over,
})

const MINUTE = 60 * 1000
const inFromNow = (ms: number) => new Date(Date.now() + ms).toISOString()

describe('google-auth', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  let setController: (controller: unknown) => void
  let realFetch: typeof fetch
  let fetches: { url: string; body: unknown }[]
  let respondTo: (url: string) => Response | Promise<Response>
  const signIn = (metadata: AuthMetadata, blob = 'encrypted-blob') => {
    worker.stored = { blob, metadata, updated_at: new Date().toISOString() }
  }

  beforeEach(() => {
    ;({ worker, uninstall: uninstallWorker, setController } = installFakeAuthWorker())
    fetches = []
    respondTo = () => new Response('not found', { status: 404 })
    realFetch = window.fetch
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      fetches.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return respondTo(url)
    }) as typeof fetch
  })

  afterEach(() => {
    window.fetch = realFetch
    uninstallWorker()
  })

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  describe('getSignInState', () => {
    it('is signed out with no sign-in', async () => {
      expect(await getSignInState()).to.equal('signed-out')
    })

    it('is signed in while the token is good, or can be refreshed', async () => {
      signIn({ access_token: 'good', expires_at: inFromNow(30 * MINUTE) })
      expect(await getSignInState()).to.equal('signed-in')
      signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE) })
      respondTo = () => json({ access_token: 'fresh', expires_in: 3600 })
      expect(await getSignInState()).to.equal('signed-in')
    })

    it('is no-drive while the sign-in has no Drive scope, and signed in once it has', async () => {
      signIn({
        access_token: 'good',
        expires_at: inFromNow(30 * MINUTE),
        scope: 'openid email profile',
      })
      expect(await getSignInState()).to.equal('no-drive')
      signIn({
        access_token: 'good',
        expires_at: inFromNow(30 * MINUTE),
        scope: 'https://www.googleapis.com/auth/drive.file openid email',
      })
      expect(await getSignInState()).to.equal('signed-in')
    })

    it('has no Drive access when the stored sign-in cannot be read', async () => {
      signIn({ scope: 'https://www.googleapis.com/auth/drive.file' })
      setController(null)
      expect(await hasDriveAccess()).to.equal(false)
    })

    it('is still expired when Google refuses a sign-in that has no Drive', async () => {
      signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE), scope: 'openid email' })
      respondTo = () => json({ error: 'invalid_grant' }, 401)
      expect(await getSignInState()).to.equal('expired')
      respondTo = () => json({}, 500)
      expect(await getSignInState()).to.equal('no-drive')
    })

    it('is expired only when Google refuses the sign-in', async () => {
      signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE) })
      respondTo = () => json({ error: 'invalid_grant' }, 401)
      expect(await getSignInState()).to.equal('expired')
      respondTo = () => json({}, 500)
      expect(await getSignInState()).to.equal('signed-in')
    })
  })

  describe('getIdentityToken', () => {
    const endingIn = (ms: number) => idToken({ exp: Math.floor((Date.now() + ms) / 1000) })

    it('says so when nobody is signed in', async () => {
      let error: Error | null = null
      await getIdentityToken().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.include('Not authenticated')
    })

    it('gives the stored one while it has more than five minutes left, with no request', async () => {
      const stored = endingIn(30 * MINUTE)
      signIn({ id_token: stored })
      expect(await getIdentityToken()).to.equal(stored)
      expect(fetches).to.have.length(0)
    })

    it('renews it with the access token, and keeps both', async () => {
      const fresh = endingIn(60 * MINUTE)
      signIn(
        { access_token: 'old', expires_at: inFromNow(-MINUTE), id_token: endingIn(2 * MINUTE) },
        'the-blob'
      )
      respondTo = () => json({ access_token: 'fresh', expires_in: 3600, id_token: fresh })

      expect(await getIdentityToken()).to.equal(fresh)

      expect(must(worker.stored).metadata.id_token).to.equal(fresh)
      expect(await getAccessToken()).to.equal('fresh')
      expect(fetches).to.have.length(1)
    })

    it('renews one it cannot read, or that it never had', async () => {
      const fresh = endingIn(60 * MINUTE)
      respondTo = () => json({ access_token: 'fresh', expires_in: 3600, id_token: fresh })
      signIn({ id_token: 'not-a-token' })
      expect(await getIdentityToken()).to.equal(fresh)

      signIn({})
      expect(await getIdentityToken()).to.equal(fresh)
    })

    it('says so when Google sent none, and keeps the access token it did send', async () => {
      signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE) })
      respondTo = () => json({ access_token: 'fresh', expires_in: 3600 })
      let error: Error | null = null
      await getIdentityToken().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.include('no ID token')
      expect(must(worker.stored).metadata.access_token).to.equal('fresh')
    })
  })

  describe('getAccessToken', () => {
    it('says so when nobody is signed in', async () => {
      let error: Error | null = null
      await getAccessToken().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.include('Not authenticated')
    })

    it('gives the stored token while it has more than five minutes left, with no request', async () => {
      signIn({ access_token: 'still-good', expires_at: inFromNow(30 * MINUTE) })
      expect(await getAccessToken()).to.equal('still-good')
      expect(fetches).to.have.length(0)
    })

    it('asks the worker for a new token, with the blob, when the old one is about to run out', async () => {
      signIn({ access_token: 'old', expires_at: inFromNow(4 * MINUTE) }, 'the-blob')
      respondTo = () => json({ access_token: 'fresh', expires_in: 3600 })

      expect(await getAccessToken()).to.equal('fresh')

      expect(fetches).to.have.length(1)
      expect(fetches[0].url).to.equal('/session/refresh')
      expect(fetches[0].body).to.deep.equal({ blob: 'the-blob' })
    })

    it('keeps the new token for next time, with its expiry, and the rest of what it knew', async () => {
      signIn(
        {
          access_token: 'old',
          expires_at: inFromNow(-MINUTE),
          user: makeUser(),
        },
        'the-blob'
      )
      respondTo = () => json({ access_token: 'fresh', expires_in: 3600 })
      await getAccessToken()

      const { blob, metadata } = must(worker.stored)
      expect(blob).to.equal('the-blob')
      expect(metadata.access_token).to.equal('fresh')
      expect(metadata.user?.name).to.equal('Ann')
      const left = new Date(must(metadata.expires_at)).getTime() - Date.now()
      expect(left).to.be.within(59 * MINUTE, 60 * MINUTE)

      // And that token is used, with no second request
      expect(await getAccessToken()).to.equal('fresh')
      expect(fetches).to.have.length(1)
    })

    it('treats a token with no expiry as expired', async () => {
      signIn({ access_token: 'unknown-age' })
      respondTo = () => json({ access_token: 'fresh', expires_in: 3600 })
      expect(await getAccessToken()).to.equal('fresh')
    })

    it("fails with the worker's reason when it refuses, and keeps what was stored", async () => {
      signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE) }, 'the-blob')
      const before = JSON.stringify(worker.stored)
      respondTo = () => json({ error: 'invalid_grant' }, 401)

      let error: Error | null = null
      await getAccessToken().catch(e => {
        error = e
      })

      expect(error).to.be.instanceOf(SignInExpiredError)
      expect(JSON.stringify(worker.stored)).to.equal(before)
    })

    it('does not take another 401 for an expired sign-in', async () => {
      signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE) })
      respondTo = () => json({ error: 'Missing blob' }, 401)
      let error: Error | null = null
      await getAccessToken().catch(e => {
        error = e
      })
      expect(error).to.not.be.instanceOf(SignInExpiredError)
      expect((error as Error | null)?.message).to.equal('Missing blob')
    })

    it('has a reason of its own when the worker answers with something that is not JSON', async () => {
      signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE) })
      respondTo = () => new Response('<html>', { status: 502 })
      let error: Error | null = null
      await getAccessToken().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.equal('Failed to refresh access token')
    })

    it('has a reason of its own when the worker gives none', async () => {
      signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE) })
      respondTo = () => json({}, 500)
      let error: Error | null = null
      await getAccessToken().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.equal('Failed to refresh access token')
    })

    it('fails when the device is offline, rather than giving the expired token', async () => {
      signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE) })
      window.fetch = (async () => {
        throw new TypeError('Failed to fetch')
      }) as typeof fetch
      let failed = false
      await getAccessToken().catch(() => {
        failed = true
      })
      expect(failed).to.equal(true)
    })
  })

  describe('being signed in', () => {
    it('is signed in when the worker holds a blob', async () => {
      expect(await isAuthenticated()).to.equal(false)
      signIn({ access_token: 'a', expires_at: inFromNow(MINUTE) })
      expect(await isAuthenticated()).to.equal(true)
    })

    it('is not signed in when the service worker does not control the page yet', async () => {
      setController(null)
      expect(await isAuthenticated()).to.equal(false)
    })

    it('logs out by having the worker forget the blob, and Google revoke the access', async () => {
      signIn({ access_token: 'a', expires_at: inFromNow(MINUTE) }, 'the-blob')
      respondTo = () => json({ success: true })

      expect(await logout()).to.deep.equal({ revoked: true })

      expect(worker.stored).to.equal(undefined)
      expect(await isAuthenticated()).to.equal(false)
      expect(fetches).to.have.length(1)
      expect(fetches[0].url).to.equal('/session/logout')
      expect(fetches[0].body).to.deep.equal({ blob: 'the-blob' })
    })

    it('is logged out all the same, and says the access is not revoked, when Google cannot be asked', async () => {
      signIn({ access_token: 'a', expires_at: inFromNow(MINUTE) })
      respondTo = () => {
        throw new TypeError('offline')
      }
      expect(await logout()).to.deep.equal({ revoked: false })
      expect(worker.stored).to.equal(undefined)

      signIn({ access_token: 'a', expires_at: inFromNow(MINUTE) })
      respondTo = () => json({ error: 'Google did not revoke the access' }, 502)
      expect(await logout()).to.deep.equal({ revoked: false })
      expect(worker.stored).to.equal(undefined)
    })

    it('asks Google for nothing when nobody is signed in', async () => {
      expect(await logout()).to.deep.equal({ revoked: false })
      expect(fetches).to.have.length(0)
    })

    it('says so when the worker cannot forget the blob, and stays signed in', async () => {
      signIn({ access_token: 'a', expires_at: inFromNow(MINUTE) })
      worker.failing.add('DELETE_BLOB')

      let error: Error | null = null
      await logout().catch(e => {
        error = e
      })

      expect((error as Error | null)?.message).to.equal('worker failed')
      expect(await isAuthenticated()).to.equal(true)
      expect(fetches, 'and the access is not revoked').to.have.length(0)
    })

    it('exports the blob for a backup, or says why not', async () => {
      let error: Error | null = null
      await exportBlobBackup().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.equal('No blob to export')

      signIn({ access_token: 'a', expires_at: inFromNow(MINUTE) }, 'the-blob')
      expect((await exportBlobBackup()).blob).to.equal('the-blob')
    })
  })

  describe('the service worker not answering well', () => {
    it('gives an empty token for a sign-in with none', async () => {
      signIn({ expires_at: inFromNow(30 * MINUTE) })
      expect(await getAccessToken()).to.equal('')
    })

    it('says why a backup could not be made, or that it could not', async () => {
      const post = worker.postMessage.bind(worker)
      let reply: object = { success: false }
      worker.postMessage = ((message: { messageId: string }, [port]: MessagePort[]) =>
        port.postMessage({ messageId: message.messageId, ...reply })) as never
      const failure = async () => {
        try {
          await exportBlobBackup()
        } catch (error) {
          return (error as Error).message
        }
        return ''
      }
      expect(await failure()).to.equal('Failed to export blob')
      reply = { success: true }
      expect(await failure()).to.equal('Failed to export blob')
      reply = { success: false, error: 'No way' }
      expect(await failure()).to.equal('No way')
      worker.postMessage = post
    })

    it('still gives the user when what it worked out cannot be sent to the worker', async () => {
      signIn({ access_token: 'a', id_token: idToken({ email: 'lee@example.com' }) })
      const post = worker.postMessage.bind(worker)
      worker.postMessage = ((message: { type: string }, ports: MessagePort[]) => {
        if (message.type === 'STORE_BLOB') throw new Error('port closed')
        return post(message as never, ports)
      }) as never
      expect(must(await getCurrentUserInfo()).email).to.equal('lee@example.com')
    })

    it('is nobody when the worker cannot be asked at all', async () => {
      worker.postMessage = () => {
        throw new Error('port closed')
      }
      const realError = console.error
      console.error = () => {}
      try {
        expect(await getCurrentUserInfo()).to.equal(null)
      } finally {
        console.error = realError
      }
    })

    it('logs what went wrong when it cannot be asked', async () => {
      const logged: unknown[][] = []
      const realError = console.error
      console.error = (...args: unknown[]) => {
        logged.push(args)
      }
      worker.postMessage = () => {
        throw new Error('port closed')
      }
      try {
        expect(await isAuthenticated()).to.equal(false)
      } finally {
        console.error = realError
      }
      expect(logged).to.have.length(1)
    })

    it('gives up waiting for an answer', async () => {
      worker.postMessage = () => {}
      const realSetTimeout = window.setTimeout
      window.setTimeout = ((fn: () => void, ms?: number) =>
        realSetTimeout(fn, ms === 10000 ? 0 : ms)) as typeof setTimeout
      let message = ''
      try {
        await exportBlobBackup()
      } catch (error) {
        message = (error as Error).message
      } finally {
        window.setTimeout = realSetTimeout
      }
      expect(message).to.equal('Service Worker timeout')
    })
  })

  describe('getCurrentUserInfo', () => {
    it('is nothing when nobody is signed in', async () => {
      expect(await getCurrentUserInfo()).to.equal(null)
    })

    it('shows the stored user as the UI wants them', async () => {
      signIn({
        access_token: 'a',
        user: makeUser({ name: 'Ann Smith', given_name: 'Ann', family_name: 'Smith' }),
      })
      expect(await getCurrentUserInfo()).to.deep.equal({
        name: 'Ann Smith',
        email: 'ann@example.com',
        picture: null,
        avatarDataUrl: null,
        givenName: 'Ann',
        familyName: 'Smith',
      })
    })

    it('works the user out from the ID token when none was stored, accents and all, and keeps them', async () => {
      signIn({
        access_token: 'a',
        id_token: idToken({ name: 'José Müller', email: 'jose@example.com', given_name: 'José' }),
      })
      const info = must(await getCurrentUserInfo())
      expect(info.name).to.equal('José Müller')
      expect(info.givenName).to.equal('José')
      expect(must(worker.stored).metadata.user?.email).to.equal('jose@example.com')
    })

    it('has a user of nothing known from an ID token that says nothing', async () => {
      signIn({ access_token: 'a', id_token: idToken({}) })
      expect(await getCurrentUserInfo()).to.deep.equal({
        name: null,
        email: null,
        picture: null,
        avatarDataUrl: null,
        givenName: null,
        familyName: null,
      })
    })

    it('still gives the user when the worker cannot keep what it worked out', async () => {
      signIn({ access_token: 'a', id_token: idToken({ email: 'kay@example.com' }) })
      worker.failing.add('STORE_BLOB')
      expect(must(await getCurrentUserInfo()).email).to.equal('kay@example.com')
    })

    it('still gives the user when the picture fails in a way that is no Error', async () => {
      signIn({ access_token: 'a', user: makeUser({ picture: 'https://pics.example/ann.png' }) })
      respondTo = () => {
        throw 'offline'
      }
      expect(must(await getCurrentUserInfo()).avatarDataUrl).to.equal(null)
    })

    it('is nothing for an ID token it cannot read', async () => {
      signIn({ access_token: 'a', id_token: 'not.a-token' })
      const error = console.error
      console.error = () => {}
      try {
        expect(await getCurrentUserInfo()).to.equal(null)
      } finally {
        console.error = error
      }
    })

    it('keeps the profile picture, to show it offline', async () => {
      signIn({
        access_token: 'a',
        user: makeUser({ picture: 'https://pics.example/ann.png' }),
      })
      respondTo = () => new Response(new Blob(['png-bytes'], { type: 'image/png' }))

      const info = must(await getCurrentUserInfo())

      expect(info.avatarDataUrl).to.match(/^data:image\/png;base64,/)
      expect(must(worker.stored).metadata.user?.avatarDataUrl).to.equal(info.avatarDataUrl)
    })

    it('still shows the user when the picture cannot be fetched', async () => {
      signIn({
        access_token: 'a',
        user: makeUser({ picture: 'https://pics.example/ann.png' }),
      })
      respondTo = () => new Response('gone', { status: 404 })
      const info = must(await getCurrentUserInfo())
      expect(info.name).to.equal('Ann')
      expect(info.avatarDataUrl).to.equal(null)
    })

    it('does not fetch the picture again once it has it', async () => {
      signIn({
        access_token: 'a',
        user: makeUser({
          picture: 'https://pics.example/ann.png',
          avatarDataUrl: 'data:image/png;base64,AAAA',
        }),
      })
      await getCurrentUserInfo()
      expect(fetches).to.have.length(0)
    })

    it('still shows the user when the worker will not store the enriched profile', async () => {
      signIn({
        access_token: 'a',
        user: makeUser({ picture: 'https://pics.example/ann.png' }),
      })
      respondTo = () => new Response(new Blob(['x'], { type: 'image/png' }))
      worker.failing.add('STORE_BLOB')
      // (the page logs why, and carries on)
      expect(must(await getCurrentUserInfo()).name).to.equal('Ann')
    })
  })
})
