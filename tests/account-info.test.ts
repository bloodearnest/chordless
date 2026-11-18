/** The account as the Worker holds it, kept on this device (account-info.ts). */
import { expect } from '@open-wc/testing'
import {
  type AccountInfo,
  cachedAccount,
  forgetAccount,
  loadAccount,
  saveAccountName,
  setAccountStorageKey,
} from '../src/js/account-info.ts'
import { type FakeAuthWorker, installFakeAuthWorker, sessionFor } from './fake-auth-worker.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

/** This file's own place for the account: test files share storage and run at once */
const KEY = 'chordless:account:test-info'

describe('account-info', () => {
  let worker: FakeAuthWorker
  let uninstallWorker: () => void
  const realFetch = window.fetch
  let calls: { method: string; authorization: string | null; body?: unknown }[]
  let answer: () => Response
  const info: AccountInfo = {
    name: 'Ann Lee',
    emails: [{ email: 'ann@example.com', provider: 'email' }],
    googleEmail: null,
  }

  beforeEach(() => {
    setAccountStorageKey(KEY)
    ;({ worker, uninstall: uninstallWorker } = installFakeAuthWorker())
    worker.stored = {
      blob: '',
      metadata: { scope: '', session: sessionFor('access-1') },
      updated_at: new Date().toISOString(),
    }
    localStorage.removeItem(KEY)
    calls = []
    answer = () => Response.json(info)
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/api/account') return realFetch(input, init)
      calls.push({
        method: init?.method ?? 'GET',
        authorization: new Headers(init?.headers).get('Authorization'),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      return answer()
    }) as typeof fetch
  })

  afterEach(() => {
    window.fetch = realFetch
    localStorage.removeItem(KEY)
    uninstallWorker()
  })

  it('is nothing before it is read', () => {
    expect(cachedAccount()).to.equal(null)
  })

  it('reads the account with the session, and keeps it for the next time', async () => {
    expect(await loadAccount()).to.deep.equal(info)
    expect(calls).to.deep.equal([
      { method: 'GET', authorization: 'Bearer access-1', body: undefined },
    ])
    expect(cachedAccount()).to.deep.equal(info)
  })

  it('is null, and keeps what it had, when the account cannot be read', async () => {
    await loadAccount()
    answer = () => Response.json({ error: 'down' }, { status: 503 })
    expect(await loadAccount()).to.equal(null)
    expect(cachedAccount()).to.deep.equal(info)
    worker.stored = undefined
    expect(await loadAccount()).to.equal(null)
  })

  it('sets the name, and keeps the account as the Worker says it now is', async () => {
    answer = () => Response.json({ ...info, name: 'Ann Leigh' })
    const saved = await saveAccountName('Ann Leigh')
    expect(saved.name).to.equal('Ann Leigh')
    expect(calls[0]).to.deep.equal({
      method: 'PUT',
      authorization: 'Bearer access-1',
      body: { name: 'Ann Leigh' },
    })
    expect(cachedAccount()?.name).to.equal('Ann Leigh')
  })

  it('says what the Worker said when it refuses the name, or its status when it says nothing', async () => {
    answer = () => Response.json({ error: 'A name is needed' }, { status: 400 })
    let message = ''
    await saveAccountName('').catch(error => {
      message = error.message
    })
    expect(message).to.equal('A name is needed')
    answer = () => new Response('oops', { status: 500, statusText: 'Server Error' })
    await saveAccountName('x').catch(error => {
      message = error.message
    })
    expect(message).to.equal('Server Error')
  })

  it('forgets the account, and ignores what is kept that is not one', async () => {
    await loadAccount()
    forgetAccount()
    expect(cachedAccount()).to.equal(null)
    localStorage.setItem(KEY, '{not json')
    expect(cachedAccount()).to.equal(null)
    localStorage.setItem(KEY, '{"name":"x"}')
    expect(cachedAccount()).to.equal(null)
  })

  it('carries on when storage cannot be used for it', async () => {
    const proto = Storage.prototype
    const { getItem, setItem, removeItem } = proto
    const refuse = (real: (key: string) => unknown) =>
      function (this: Storage, key: string) {
        if (key === KEY) throw new Error('blocked')
        return real.call(this, key)
      }
    proto.getItem = refuse(getItem) as typeof getItem
    proto.setItem = function (this: Storage, key: string, value: string) {
      if (key === KEY) throw new Error('blocked')
      return setItem.call(this, key, value)
    }
    proto.removeItem = refuse(removeItem) as typeof removeItem
    try {
      expect(cachedAccount()).to.equal(null)
      forgetAccount()
    } finally {
      proto.getItem = getItem
      proto.setItem = setItem
      proto.removeItem = removeItem
    }
  })

  it('carries on when it cannot keep what it read', async () => {
    const proto = Storage.prototype
    const { setItem } = proto
    proto.setItem = function (this: Storage, key: string, value: string) {
      if (key === KEY) throw new Error('blocked')
      return setItem.call(this, key, value)
    }
    try {
      expect(await loadAccount()).to.deep.equal(info)
    } finally {
      proto.setItem = setItem
    }
  })
})
