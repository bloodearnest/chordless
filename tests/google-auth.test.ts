import { expect } from '@open-wc/testing'
import { type AuthMetadata, deleteBlob, type StoredUser, storeBlob } from '../src/js/auth-db.ts'
import {
  disconnectDrive,
  type EmailCodeError,
  getAccessToken,
  getCurrentUserInfo,
  getIdentityToken,
  getSignInState,
  hasDriveAccess,
  isAuthenticated,
  logout,
  peekSignInLink,
  SignInExpiredError,
  signInWithEmail,
  signInWithLink,
  startEmailSignIn,
  storeSignIn,
} from '../src/js/google-auth.ts'
import { type FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { deleteDatabase, settleSignIn, suppressConsoleLogs } from './test-helpers.ts'

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
  /**
   * A stored sign-in: by default one as it is now (no Google blob, which the Worker holds for the account, and a session
   * that is good); a blob makes it a device from before, which has its own.
   */
  const signIn = (metadata: AuthMetadata, blob = '') => {
    const session = blob
      ? undefined
      : {
          access_token: 'session-access',
          refresh_token: 'id.r',
          expires_at: inFromNow(30 * MINUTE),
        }
    worker.stored = {
      blob,
      metadata: { ...(session ? { session } : {}), ...metadata },
      updated_at: new Date().toISOString(),
    }
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

  afterEach(async () => {
    // (before the stubs go: what a sign-in began in the background ends here, not in the next test)
    await settleSignIn()
    window.fetch = realFetch
    uninstallWorker()
  })

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  describe('getSignInState', () => {
    it('is signed out with no sign-in', async () => {
      expect(await getSignInState()).to.equal('signed-out')
    })

    it('is signed in while the token is good, or can be had from the Worker', async () => {
      signIn({ drive: true, access_token: 'good', expires_at: inFromNow(30 * MINUTE) })
      expect(await getSignInState()).to.equal('signed-in')
      signIn({ drive: true, access_token: 'old', expires_at: inFromNow(-MINUTE) })
      respondTo = () => json({ access_token: 'fresh', expires_in: 3600 })
      expect(await getSignInState()).to.equal('signed-in')
    })

    it('is no-drive while the account has no Drive connected, and signed in once it has', async () => {
      signIn({ drive: false, access_token: 'good', expires_at: inFromNow(30 * MINUTE) })
      respondTo = () => json({ error: 'not_connected' }, 404)
      expect(await getSignInState()).to.equal('no-drive')
      signIn({ drive: true, access_token: 'good', expires_at: inFromNow(30 * MINUTE) })
      expect(await getSignInState()).to.equal('signed-in')
    })

    it('says a device from before has Drive by the scope of its own blob, until the blob is moved', async () => {
      signIn(
        { scope: 'openid email profile', access_token: 'g', expires_at: inFromNow(MINUTE * 30) },
        'a-blob'
      )
      expect(await hasDriveAccess()).to.equal(false)
      signIn(
        { scope: 'https://www.googleapis.com/auth/drive.file openid', access_token: 'g' },
        'a-blob'
      )
      expect(await hasDriveAccess()).to.equal(true)
    })

    it('has no Drive access when the stored sign-in cannot be read', async () => {
      signIn({ scope: 'https://www.googleapis.com/auth/drive.file' })
      // (with no service worker in control, the page reads it itself: from a database it cannot open)
      setController(null)
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('auth', 99)
        request.onsuccess = () => {
          request.result.close()
          resolve()
        }
        request.onerror = () => reject(request.error)
      })
      try {
        expect(await hasDriveAccess()).to.equal(false)
      } finally {
        await deleteDatabase('auth')
      }
    })

    it('has no Drive access when the service worker cannot be asked', async () => {
      signIn({ scope: 'https://www.googleapis.com/auth/drive.file' })
      setController({
        postMessage() {
          throw new Error('gone')
        },
      })
      expect(await hasDriveAccess()).to.equal(false)
    })

    it('is still expired when Google refuses a device from before whose own sign-in has no Drive', async () => {
      signIn(
        { access_token: 'old', expires_at: inFromNow(-MINUTE), scope: 'openid email' },
        'a-blob'
      )
      respondTo = () => json({ error: 'invalid_grant' }, 401)
      expect(await getSignInState()).to.equal('expired')
      respondTo = () => json({}, 500)
      expect(await getSignInState()).to.equal('no-drive')
    })

    it('does not ask the Worker for a token when the account has no Drive, which cannot have expired', async () => {
      signIn({ drive: false })
      expect(await getSignInState()).to.equal('no-drive')
      expect(fetches).to.have.length(0)
    })

    it('is expired only when Google refuses the sign-in, or the Worker cannot read it', async () => {
      signIn({ drive: true, access_token: 'old', expires_at: inFromNow(-MINUTE) })
      respondTo = () => json({ error: 'invalid_grant' }, 401)
      expect(await getSignInState()).to.equal('expired')
      respondTo = () => json({ error: 'invalid_blob' }, 401)
      expect(await getSignInState()).to.equal('expired')
      respondTo = () => json({}, 500)
      expect(await getSignInState()).to.equal('signed-in')
    })
  })

  describe('getIdentityToken', () => {
    const session = (over: object = {}) => ({
      access_token: 'access-1',
      refresh_token: 'id.secret-1',
      expires_at: inFromNow(10 * MINUTE),
      ...over,
    })
    const tokens = (n: number) => ({
      access_token: `access-${n}`,
      refresh_token: `id.secret-${n}`,
      expires_in: 900,
    })

    it('says so when nobody is signed in', async () => {
      let error: Error | null = null
      await getIdentityToken().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.include('Not authenticated')
    })

    it('gives the session’s access token while it has more than five minutes left, with no request', async () => {
      signIn({ session: session() })
      expect(await getIdentityToken()).to.equal('access-1')
      expect(fetches).to.have.length(0)
    })

    it('renews it with the refresh token, and keeps the next one with the sign-in', async () => {
      signIn({ access_token: 'drive', session: session({ expires_at: inFromNow(MINUTE) }) })
      respondTo = () => json(tokens(2))

      expect(await getIdentityToken()).to.equal('access-2')

      expect(fetches.map(each => each.url)).to.deep.equal(['/session/token'])
      expect(fetches[0].body).to.deep.equal({ refresh_token: 'id.secret-1' })
      const stored = must(worker.stored).metadata
      expect(stored.session?.refresh_token).to.equal('id.secret-2')
      expect(stored.access_token).to.equal('drive')
    })

    it('gets a session from the blob, silently, for a sign-in made before sessions', async () => {
      signIn({ access_token: 'drive' }, 'the-blob')
      respondTo = () => json(tokens(1))

      expect(await getIdentityToken()).to.equal('access-1')

      expect(fetches.map(each => each.url)).to.deep.equal(['/session/upgrade'])
      expect(fetches[0].body).to.deep.equal({ blob: 'the-blob' })
      expect(must(worker.stored).metadata.session?.refresh_token).to.equal('id.secret-1')
    })

    it('falls back to the blob when the session has ended or was revoked', async () => {
      signIn({ session: session({ expires_at: inFromNow(-MINUTE) }) }, 'the-blob')
      respondTo = url =>
        url === '/session/token' ? json({ error: 'invalid_session' }, 401) : json(tokens(3))

      expect(await getIdentityToken()).to.equal('access-3')
      expect(fetches.map(each => each.url)).to.deep.equal(['/session/token', '/session/upgrade'])
    })

    it('says the sign-in has expired when the Worker cannot read the blob', async () => {
      signIn({}, 'old-blob')
      respondTo = () => json({ error: 'invalid_blob' }, 401)
      let error: unknown
      await getIdentityToken().catch(e => {
        error = e
      })
      expect(error).to.be.instanceOf(SignInExpiredError)
    })

    it('fails with the Worker’s own words for any other refusal', async () => {
      signIn({}, 'a-blob')
      respondTo = () => json({ error: 'Sessions are not set up' }, 503)
      let error: Error | null = null
      await getIdentityToken().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.equal('Sessions are not set up')
    })
  })

  describe('signing in with an emailed code', () => {
    it('asks the Worker to mail the code, and says why when it cannot', async () => {
      respondTo = () => json({ ok: true })
      await startEmailSignIn('ann@example.com')
      expect(fetches).to.deep.equal([
        { url: '/session/email/start', body: { address: 'ann@example.com' } },
      ])
      const why = async (response: Response) => {
        respondTo = () => response
        return startEmailSignIn('ann@example.com').catch(e => (e as EmailCodeError).reason)
      }
      expect(await why(json({ error: 'invalid_address' }, 400))).to.equal('invalid_address')
      expect(await why(json({ error: 'too_many' }, 429))).to.equal('too_often')
      expect(await why(json({ error: 'send_failed' }, 502))).to.equal('failed')
      expect(await why(new Response('oops', { status: 500 }))).to.equal('failed')
    })

    it('learns that the account has Drive from another device, and is signed in with it', async () => {
      respondTo = url =>
        url === '/api/account'
          ? json({
              name: null,
              emails: [],
              googleEmail: null,
              drive: { email: 'ann@gmail.example' },
            })
          : json({
              access_token: 'a1',
              refresh_token: 'id.secret',
              expires_in: 900,
              email: 'ann@example.com',
            })
      await signInWithEmail('ann@example.com', '123456')
      await settleSignIn()
      expect(must(worker.stored).metadata.drive).to.equal(true)
      expect(await hasDriveAccess()).to.equal(true)
    })

    it('keeps the session, with no Google blob, and is signed in without Drive', async () => {
      respondTo = () =>
        json({
          access_token: 'a1',
          refresh_token: 'id.secret',
          expires_in: 900,
          email: 'ann@example.com',
        })
      await signInWithEmail('ann@example.com', '123456')
      const stored = must(worker.stored)
      expect(stored.blob).to.equal('')
      expect(stored.metadata.session?.refresh_token).to.equal('id.secret')
      expect(stored.metadata.user?.email).to.equal('ann@example.com')
      expect(await getSignInState()).to.equal('no-drive')
      expect(await getIdentityToken()).to.equal('a1')
      respondTo = () => json({ error: 'not_connected' }, 404)
      let error: Error | null = null
      await getAccessToken().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.include('Google Drive is not connected')
    })

    it('signs in with the link, with no Google blob, and says where to go on to', async () => {
      respondTo = () =>
        json({
          access_token: 'a1',
          refresh_token: 'id.secret',
          expires_in: 900,
          email: 'ann@example.com',
          next: '/join/x/y',
        })
      expect(await signInWithLink('abcdefghijklmnopqrstuv')).to.equal('/join/x/y')
      // (the sign-in's own request: it also starts, in the background, looking for the person's teams and
      // for a name, which ask the Worker for their own things)
      await settleSignIn()
      expect(fetches.filter(each => each.url.startsWith('/session/'))).to.deep.equal([
        { url: '/session/email/link', body: { id: 'abcdefghijklmnopqrstuv' } },
      ])
      expect(must(worker.stored).blob).to.equal('')
      expect(must(worker.stored).metadata.user?.email).to.equal('ann@example.com')
      respondTo = () =>
        json({ access_token: 'a', refresh_token: 'r', expires_in: 9, email: 'a@b.co' })
      expect(await signInWithLink('abcdefghijklmnopqrstuv')).to.equal('/')
    })

    it('says so when the link is not good, and shows what it is for without using it', async () => {
      respondTo = () => json({ error: 'invalid_link' }, 401)
      const reason = await signInWithLink('x').catch(e => (e as EmailCodeError).reason)
      expect(reason).to.equal('expired')
      expect(await peekSignInLink('x').catch(e => (e as EmailCodeError).reason)).to.equal('expired')
      respondTo = () => json({ address: 'ann@example.com', code: '123456', next: '/songs' })
      expect(await peekSignInLink('abcdefghijklmnopqrstuv')).to.deep.equal({
        address: 'ann@example.com',
        code: '123456',
        next: '/songs',
      })
      expect(fetches.at(-1)?.url).to.equal('/session/email/link/peek')
      respondTo = () => json({ address: 'ann@example.com', code: '123456' })
      expect((await peekSignInLink('x')).next).to.equal('/')
      expect(worker.stored).to.equal(undefined)
    })

    it('says so when the sign-in cannot be kept', async () => {
      respondTo = () => json({ access_token: 'a1', refresh_token: 'id.secret', expires_in: 900 })
      worker.failing.add('STORE_BLOB')
      let error: Error | null = null
      await signInWithEmail('ann@example.com', '123456').catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.equal('worker failed')
    })

    it('says why a code was refused', async () => {
      const why = async (body: object) => {
        respondTo = () => json(body, 401)
        return signInWithEmail('ann@example.com', '1').catch(e => (e as EmailCodeError).reason)
      }
      expect(await why({ error: 'invalid_code', reason: 'wrong' })).to.equal('wrong')
      expect(await why({ error: 'invalid_code', reason: 'expired' })).to.equal('expired')
      expect(await why({ error: 'invalid_code', reason: 'too_many' })).to.equal('too_many')
      expect(await why({ error: 'x', reason: 'odd' })).to.equal('failed')
      expect(worker.stored).to.equal(undefined)
    })

    it('has to sign in again when the session ends: there is no blob to start from', async () => {
      worker.stored = {
        blob: '',
        metadata: {
          session: { access_token: 'a', refresh_token: 'r', expires_at: inFromNow(-MINUTE) },
        },
        updated_at: new Date().toISOString(),
      }
      respondTo = () => json({ error: 'invalid_session' }, 401)
      let error: unknown
      await getIdentityToken().catch(e => {
        error = e
      })
      expect(error).to.be.instanceOf(SignInExpiredError)
    })

    it('ends the session at the Worker at sign-out, with or without Google', async () => {
      worker.stored = {
        blob: '',
        metadata: {
          session: { access_token: 'a', refresh_token: 'r', expires_at: inFromNow(MINUTE) },
        },
        updated_at: new Date().toISOString(),
      }
      respondTo = () => json({ success: true })
      await logout()
      expect(fetches.map(each => each.url)).to.include('/session/logout')
      expect(fetches.at(-1)?.body).to.deep.equal({ refresh_token: 'r' })
      expect(worker.stored).to.equal(undefined)
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

    it('asks the Worker for a Drive token, with the session, when the old one is about to run out', async () => {
      signIn({ drive: true, access_token: 'old', expires_at: inFromNow(4 * MINUTE) })
      respondTo = () => json({ access_token: 'fresh', expires_in: 3600 })

      expect(await getAccessToken()).to.equal('fresh')

      expect(fetches).to.have.length(1)
      expect(fetches[0].url).to.equal('/api/account/drive/token')
    })

    it('keeps the new token for next time, with its expiry, and the rest of what it knew', async () => {
      signIn({
        drive: true,
        access_token: 'old',
        expires_at: inFromNow(-MINUTE),
        user: makeUser(),
      })
      respondTo = () => json({ access_token: 'fresh', expires_in: 3600 })
      await getAccessToken()

      const { blob, metadata } = must(worker.stored)
      expect(blob, 'there is no Google credential on the device').to.equal('')
      expect(metadata.access_token).to.equal('fresh')
      expect(metadata.drive).to.equal(true)
      expect(metadata.user?.name).to.equal('Ann')
      const left = new Date(must(metadata.expires_at)).getTime() - Date.now()
      expect(left).to.be.within(59 * MINUTE, 60 * MINUTE)

      // And that token is used, with no second request
      expect(await getAccessToken()).to.equal('fresh')
      expect(fetches).to.have.length(1)
    })

    it('says Drive is not connected when the account has none, and remembers it', async () => {
      signIn({ drive: true, access_token: 'old', expires_at: inFromNow(-MINUTE) })
      respondTo = () => json({ error: 'not_connected' }, 404)
      let error: Error | null = null
      await getAccessToken().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.equal('Google Drive is not connected')
      expect(must(worker.stored).metadata.drive).to.equal(false)
      // (and a token kept from before is not given for an account that has none)
      signIn({ drive: false, access_token: 'kept', expires_at: inFromNow(30 * MINUTE) })
      await getAccessToken().catch(() => {})
      expect(fetches).to.have.length(2)
    })

    describe('on a device that signed in before the Worker held the credential', () => {
      const adopted = (url: string) =>
        url === '/api/account/drive/adopt'
          ? json({ adopted: true })
          : url === '/api/account'
            ? json({
                name: null,
                emails: [],
                googleEmail: null,
                drive: { email: 'ann@example.com' },
              })
            : json({ access_token: 'fresh', expires_in: 3600 })

      it('sends its blob to the account, once, forgets it, and carries on as any device does', async () => {
        signIn(
          {
            access_token: 'old',
            expires_at: inFromNow(-MINUTE),
            session: { access_token: 's', refresh_token: 'r', expires_at: inFromNow(30 * MINUTE) },
          },
          'the-blob'
        )
        respondTo = adopted

        expect(await getAccessToken()).to.equal('fresh')

        expect(fetches.map(each => each.url)).to.deep.equal([
          '/api/account/drive/adopt',
          '/api/account',
          '/api/account/drive/token',
        ])
        expect(fetches[0].body).to.deep.equal({ blob: 'the-blob' })
        expect(must(worker.stored).blob).to.equal('')
        expect(must(worker.stored).metadata.drive).to.equal(true)
        expect(must(worker.stored).metadata.session?.refresh_token).to.equal('r')
      })

      it('forgets the blob when the account already has a connection (another device made it since)', async () => {
        signIn({ access_token: 'g', expires_at: inFromNow(30 * MINUTE) }, 'old-blob')
        respondTo = url =>
          url === '/api/account/drive/adopt' ? json({ adopted: false }) : adopted(url)
        // (a session, got from the blob: this device had none)
        worker.stored = must(worker.stored)
        worker.stored.metadata.session = {
          access_token: 's',
          refresh_token: 'r',
          expires_at: inFromNow(30 * MINUTE),
        }
        await getAccessToken()
        expect(must(worker.stored).blob).to.equal('')
      })

      it('keeps working from its own blob when the Worker cannot be reached to move it', async () => {
        signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE) }, 'the-blob')
        must(worker.stored).metadata.session = {
          access_token: 's',
          refresh_token: 'r',
          expires_at: inFromNow(30 * MINUTE),
        }
        respondTo = url =>
          url === '/session/refresh'
            ? json({ access_token: 'fresh', expires_in: 3600 })
            : json({ error: 'down' }, 503)

        expect(await getAccessToken()).to.equal('fresh')

        expect(fetches.at(-1)?.url).to.equal('/session/refresh')
        expect(fetches.at(-1)?.body).to.deep.equal({ blob: 'the-blob' })
        expect(must(worker.stored).blob, 'to try again next time').to.equal('the-blob')
      })

      it('says the sign-in has expired when Google refuses the blob it still holds', async () => {
        signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE) }, 'the-blob')
        must(worker.stored).metadata.session = {
          access_token: 's',
          refresh_token: 'r',
          expires_at: inFromNow(30 * MINUTE),
        }
        respondTo = url =>
          url === '/session/refresh' ? json({ error: 'invalid_grant' }, 401) : json({}, 503)
        let error: unknown
        await getAccessToken().catch(e => {
          error = e
        })
        expect(error).to.be.instanceOf(SignInExpiredError)
      })
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
      expect((error as Error | null)?.message).to.equal('Failed to get a Google Drive access token')
    })

    it('has a reason of its own when the worker gives none', async () => {
      signIn({ access_token: 'old', expires_at: inFromNow(-MINUTE) })
      respondTo = () => json({}, 500)
      let error: Error | null = null
      await getAccessToken().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.equal('Failed to get a Google Drive access token')
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

    it('reads the sign-in itself when the service worker does not control the page (a first visit, a hard reload)', async () => {
      setController(null)
      expect(await isAuthenticated()).to.equal(false)
      await storeBlob('stored-here', {
        access_token: 'a',
        expires_at: inFromNow(MINUTE),
        id_token: 'i',
      })
      try {
        expect(await isAuthenticated()).to.equal(true)
      } finally {
        await deleteBlob()
      }
    })

    it('logs out by having the worker forget the blob, and asks Google for nothing', async () => {
      signIn({ access_token: 'a', expires_at: inFromNow(MINUTE) }, 'the-blob')

      await logout()

      expect(worker.stored).to.equal(undefined)
      expect(await isAuthenticated()).to.equal(false)
      expect(fetches, 'other devices keep their sign-in').to.have.length(0)
    })

    it('disconnects Drive from the account: the Worker is told, the session stays, and Drive is no longer had', async () => {
      worker.stored = {
        blob: '',
        metadata: {
          access_token: 'a',
          expires_at: inFromNow(MINUTE),
          id_token: 'i',
          drive: true,
          scope: 'https://www.googleapis.com/auth/drive.file openid email',
          session: { access_token: 's', refresh_token: 'r', expires_at: inFromNow(30 * MINUTE) },
          user: makeUser(),
        },
        updated_at: new Date().toISOString(),
      }
      respondTo = url =>
        url === '/api/account/drive'
          ? json({ success: true, revoked: true })
          : json({ name: null, emails: [], googleEmail: null, drive: null })

      expect(await disconnectDrive()).to.deep.equal({ revoked: true })

      const stored = must(worker.stored)
      expect(stored.metadata.session?.refresh_token).to.equal('r')
      expect(stored.metadata.user?.email).to.equal('ann@example.com')
      expect(stored.metadata.access_token).to.equal(undefined)
      expect(stored.metadata.drive).to.equal(false)
      expect(await isAuthenticated()).to.equal(true)
      expect(await getSignInState()).to.equal('no-drive')
      expect(fetches[0].url).to.equal('/api/account/drive')
    })

    it('says whether Google was left alone, when a Team the person owns still uses the grant', async () => {
      worker.stored = {
        blob: '',
        metadata: {
          drive: true,
          session: { access_token: 's', refresh_token: 'r', expires_at: inFromNow(30 * MINUTE) },
        },
        updated_at: new Date().toISOString(),
      }
      respondTo = url =>
        url === '/api/account/drive' ? json({ success: true, revoked: false }) : json({})
      expect(await disconnectDrive()).to.deep.equal({ revoked: false })
    })

    it('says so when Google or the Worker will not, and stays connected', async () => {
      worker.stored = {
        blob: '',
        metadata: {
          drive: true,
          session: { access_token: 's', refresh_token: 'r', expires_at: inFromNow(30 * MINUTE) },
        },
        updated_at: new Date().toISOString(),
      }
      respondTo = () => json({ error: 'Google did not revoke the access' }, 502)
      let error: Error | null = null
      await disconnectDrive().catch(e => {
        error = e
      })
      expect((error as Error | null)?.message).to.equal('Google did not revoke the access')
      expect(must(worker.stored).metadata.drive).to.equal(true)
    })
  })

  describe('the service worker not answering well', () => {
    it('gives an empty token for a sign-in with none', async () => {
      signIn({ expires_at: inFromNow(30 * MINUTE) })
      expect(await getAccessToken()).to.equal('')
    })

    it('says why the worker could not keep a sign-in, or that it could not', async () => {
      const post = worker.postMessage.bind(worker)
      let reply: object = { success: false }
      worker.postMessage = ((message: { messageId: string }, [port]: MessagePort[]) =>
        port.postMessage({ messageId: message.messageId, ...reply })) as never
      const failure = async () => {
        try {
          await storeSignIn('b', {})
        } catch (error) {
          return (error as Error).message
        }
        return ''
      }
      expect(await failure()).to.equal('Failed to store the sign-in')
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
        await logout()
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
