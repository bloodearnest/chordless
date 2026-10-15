/** Naming the organisation after the Google account the first time someone signs in */
import { expect } from '@open-wc/testing'
import {
  checkFirstTimeAuth,
  handleFirstTimeAuth,
  nameOrganisationBeforeSync,
} from '../src/js/first-time-auth.ts'
import {
  createOrganisation,
  deleteOrganisation,
  getCurrentOrganisation,
  listOrganisations,
  setCurrentOrganisation,
} from '../src/js/organisation.ts'
import { FakeAuthWorker, installFakeAuthWorker } from './fake-auth-worker.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const KEY = 'first-auth-done'

describe('the first sign-in', () => {
  let before: { id: string | null; name: string }
  let personal: { id: string; name: string }
  let auth: ReturnType<typeof installFakeAuthWorker>
  let worker: FakeAuthWorker
  let switched: string[]
  const switchTo = async (id: string) => {
    switched.push(id)
  }
  const made: string[] = []

  /** Sign in as this person (a name of null has the account give none) */
  function signIn(name: string | null) {
    worker.stored = {
      blob: 'blob',
      metadata: {
        user: {
          name,
          email: 'a@example.com',
          picture: null,
          given_name: null,
          family_name: null,
          sub: 's',
        },
      },
      updated_at: 'now',
    }
  }

  beforeEach(async () => {
    localStorage.removeItem(KEY)
    switched = []
    worker = new FakeAuthWorker()
    auth = installFakeAuthWorker(worker)
    before = getCurrentOrganisation()
    // A "Personal" organisation is the default one: use the one there is, or make it
    const existing = (await listOrganisations()).find(org => org.name === 'Personal')
    personal = existing ?? (await createOrganisation('Personal'))
    if (!existing) made.push(personal.id)
    await setCurrentOrganisation(personal.id, personal.name)
  })

  afterEach(async () => {
    auth.uninstall()
    localStorage.removeItem(KEY)
    // (renamed ones go back to what they were, so the next test finds "Personal")
    const renamed = (await listOrganisations()).find(org => org.id === personal.id)
    if (renamed && renamed.name !== 'Personal') {
      const { renameOrganisation } = await import('../src/js/organisation.ts')
      await renameOrganisation(personal.id, 'Personal')
    }
    while (made.length) await deleteOrganisation(made.pop() as string)
    if (before.id) await setCurrentOrganisation(before.id, before.name)
  })

  const nameNow = async () => (await listOrganisations()).find(org => org.id === personal.id)?.name

  describe('on starting the app', () => {
    it('does nothing once it has been done', async () => {
      localStorage.setItem(KEY, 'true')
      signIn('Ann Smith')
      expect(await checkFirstTimeAuth(switchTo)).to.equal(false)
      expect(worker.messages).to.have.length(0)
    })

    it('does nothing for someone who is not signed in', async () => {
      expect(await checkFirstTimeAuth(switchTo)).to.equal(false)
      expect(switched).to.deep.equal([])
      expect(localStorage.getItem(KEY)).to.equal(null)
    })

    it('renames "Personal" to the name of the account, and switches to it, once', async () => {
      signIn('Ann Smith')
      expect(await checkFirstTimeAuth(switchTo)).to.equal(true)
      expect(await nameNow()).to.equal('Ann Smith')
      expect(switched).to.deep.equal([personal.id])
      expect(localStorage.getItem(KEY)).to.equal('true')
      expect(await checkFirstTimeAuth(switchTo)).to.equal(false)
    })
  })

  describe('handling it', () => {
    it('does nothing when it has been done', async () => {
      localStorage.setItem(KEY, 'true')
      expect(await handleFirstTimeAuth(switchTo)).to.equal(false)
    })

    it('waits for an account with a name', async () => {
      signIn(null)
      expect(await handleFirstTimeAuth(switchTo)).to.equal(false)
      expect(localStorage.getItem(KEY)).to.equal(null)
    })

    it('has nothing to rename without a current organisation', async () => {
      signIn('Ann Smith')
      localStorage.removeItem('current-organisation-id')
      localStorage.removeItem('current-organisation-name')
      expect(await handleFirstTimeAuth(switchTo)).to.equal(false)
      expect(localStorage.getItem(KEY)).to.equal('true')
    })

    it('leaves an organisation that is not called "Personal"', async () => {
      signIn('Ann Smith')
      const other = await createOrganisation(`Church ${crypto.randomUUID().slice(0, 8)}`)
      made.push(other.id)
      await setCurrentOrganisation(other.id, other.name)
      expect(await handleFirstTimeAuth(switchTo)).to.equal(false)
      expect(localStorage.getItem(KEY)).to.equal('true')
      expect(switched).to.deep.equal([])
    })

    it('gives up, and does not try again, when it fails', async () => {
      signIn('Ann Smith')
      // Another organisation already has the name
      const taken = await createOrganisation('Ann Smith')
      made.push(taken.id)
      expect(await handleFirstTimeAuth(switchTo)).to.equal(false)
      expect(localStorage.getItem(KEY)).to.equal('true')
      expect(await nameNow()).to.equal('Personal')
    })
  })

  describe('before syncing', () => {
    it('renames "Personal" to the account, without switching', async () => {
      signIn('Ann Smith')
      expect(await nameOrganisationBeforeSync()).to.equal(true)
      expect(await nameNow()).to.equal('Ann Smith')
      expect(localStorage.getItem(KEY)).to.equal('true')
      expect(getCurrentOrganisation().name).to.equal('Ann Smith')
    })

    it('leaves an organisation that is not called "Personal", or none', async () => {
      signIn('Ann Smith')
      const other = await createOrganisation(`Church ${crypto.randomUUID().slice(0, 8)}`)
      made.push(other.id)
      await setCurrentOrganisation(other.id, other.name)
      expect(await nameOrganisationBeforeSync()).to.equal(false)
      localStorage.removeItem('current-organisation-id')
      expect(await nameOrganisationBeforeSync()).to.equal(false)
    })

    it('leaves it alone for an account with no name', async () => {
      signIn(null)
      expect(await nameOrganisationBeforeSync()).to.equal(false)
      expect(await nameNow()).to.equal('Personal')
    })
  })
})
