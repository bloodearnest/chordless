/** Asking for their name once they are signed in with none (account-name.ts, name-prompt.ts). */
import { expect, waitUntil } from '@open-wc/testing'
import '../src/components/name-prompt.ts'
import type { NamePrompt } from '../src/components/name-prompt.ts'
import { type AccountInfo, setAccountStorageKey } from '../src/js/account-info.ts'
import { maybeAskName } from '../src/js/account-name.ts'
import { type FakeAuthWorker, installFakeAuthWorker, sessionFor } from './fake-auth-worker.ts'
import { must } from './must.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

/** This file's own place for the account: test files share storage and run at once */
const KEY = 'chordless:account:test-name'

describe('asking for their name', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  let account: AccountInfo | null
  let puts: unknown[]
  const realPath = window.location.pathname + window.location.search
  const prompt = () => document.querySelector<NamePrompt>('name-prompt')

  const signIn = (name: string | null = null) => {
    worker.stored = {
      blob: '',
      metadata: {
        scope: '',
        session: sessionFor('access-1'),
        user: {
          name,
          email: 'ann@example.com',
          picture: null,
          given_name: null,
          family_name: null,
          sub: null,
        },
      },
      updated_at: new Date().toISOString(),
    }
  }

  beforeEach(() => {
    setAccountStorageKey(KEY)
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    account = {
      name: null,
      emails: [{ email: 'ann@example.com', provider: 'email' }],
      googleEmail: null,
    }
    puts = []
    localStorage.removeItem(KEY)
    sessionStorage.removeItem('chordless:name-asked')
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/api/account') return realFetch(input, init)
      if (!account) return Response.json({ error: 'down' }, { status: 503 })
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        puts.push(body)
        if (body.name === 'refuse')
          return Response.json({ error: 'A name is needed' }, { status: 400 })
        account = { ...account, name: body.name }
      }
      return Response.json(account)
    }) as typeof fetch
  })

  afterEach(() => {
    prompt()?.remove()
    window.fetch = realFetch
    history.replaceState(null, '', realPath)
    localStorage.removeItem(KEY)
    sessionStorage.removeItem('chordless:name-asked')
    uninstallWorker()
  })

  it('asks nobody who is not signed in, or who has a name', async () => {
    await maybeAskName()
    expect(prompt()).to.equal(null)
    signIn()
    account = { ...(account as AccountInfo), name: 'Ann Lee' }
    await maybeAskName()
    expect(prompt()).to.equal(null)
  })

  it('asks someone signed in with no name, starting from the name their sign-in gave', async () => {
    signIn('Ann From Google')
    await maybeAskName()
    const asked = must(prompt())
    expect(asked.suggested).to.equal('Ann From Google')
    await asked.updateComplete
    expect(asked.shadowRoot?.querySelector('app-modal')?.getAttribute('heading')).to.equal(
      'What should we call you?'
    )
  })

  it('asks once a visit, not again, and uses what the device kept when the Worker cannot be reached', async () => {
    signIn()
    await maybeAskName()
    prompt()?.remove()
    await maybeAskName()
    expect(prompt()).to.equal(null)
    sessionStorage.removeItem('chordless:name-asked')
    account = null
    localStorage.setItem(
      'chordless:account',
      JSON.stringify({ name: null, emails: [], googleEmail: null })
    )
    await maybeAskName()
    expect(prompt()).to.not.equal(null)
  })

  it('does not ask when it knows nothing of the account', async () => {
    signIn()
    account = null
    await maybeAskName()
    expect(prompt()).to.equal(null)
  })

  it('leaves the join page alone: they are in the middle of something', async () => {
    signIn()
    history.replaceState(null, '', '/join/space-aaaa1111/abcdefghijklmnopqrstuv')
    await maybeAskName()
    expect(prompt()).to.equal(null)
  })

  it('asks again if storage cannot say it was asked', async () => {
    signIn()
    const proto = Storage.prototype
    const { getItem, setItem } = proto
    const ASKED = 'chordless:name-asked'
    proto.getItem = function (this: Storage, key: string) {
      if (key === ASKED) throw new Error('blocked')
      return getItem.call(this, key)
    }
    proto.setItem = function (this: Storage, key: string, value: string) {
      if (key === ASKED) throw new Error('blocked')
      return setItem.call(this, key, value)
    }
    try {
      await maybeAskName()
      expect(prompt()).to.not.equal(null)
    } finally {
      proto.getItem = getItem
      proto.setItem = setItem
    }
  })

  describe('the question', () => {
    const open = async () => {
      signIn('Ann From Google')
      await maybeAskName()
      const asked = must(prompt())
      await asked.updateComplete
      await waitUntil(() => asked._modal.value?.open, 'the question')
      return asked
    }
    const submit = (asked: NamePrompt, name: string) => {
      const form = must(asked.shadowRoot?.querySelector<HTMLFormElement>('form'))
      ;(form.elements.namedItem('name') as HTMLInputElement).value = name
      form.requestSubmit()
    }

    it('keeps the name, and goes', async () => {
      const asked = await open()
      submit(asked, 'Ann Lee')
      await waitUntil(() => !prompt(), 'the question to go')
      expect(puts).to.deep.equal([{ name: 'Ann Lee' }])
    })

    it('says what the Worker said when it refuses, and stays for another try', async () => {
      const asked = await open()
      submit(asked, 'refuse')
      await waitUntil(() => asked.shadowRoot?.querySelector('.error'), 'the refusal')
      expect(asked.shadowRoot?.querySelector('.error')?.textContent).to.contain('A name is needed')
      expect(prompt()).to.not.equal(null)
    })

    it('goes when they say not now, and when the modal is closed any way', async () => {
      const asked = await open()
      const later = must(
        Array.from(asked.shadowRoot?.querySelectorAll('button') ?? []).find(each =>
          each.textContent?.includes('Not now')
        )
      )
      later.click()
      await waitUntil(() => !prompt(), 'the question to go')
      expect(puts).to.deep.equal([])
      const another = await open_()
      another.remove()
    })

    it('ignores the close of something inside it', async () => {
      const asked = await open()
      asked._leave(Object.assign(new Event('x'), {}))
      expect(prompt()).to.not.equal(null)
    })
  })
})

/** A question made by hand, for the close that is not from its own modal */
async function open_(): Promise<NamePrompt> {
  const asked = document.createElement('name-prompt')
  document.body.append(asked)
  await asked.updateComplete
  return asked
}
