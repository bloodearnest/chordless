import { expect } from '@open-wc/testing'
import { persistentStorageRequester } from '../src/js/utils/persistence.ts'

const { describe, it, afterEach } = window

describe('asking for persistent storage', () => {
  const realInfo = console.info
  const realWarn = console.warn
  let logged: unknown[]
  let warned: unknown[]

  const capture = () => {
    logged = []
    warned = []
    console.info = (message: unknown) => logged.push(message)
    console.warn = (...args: unknown[]) => warned.push(args)
  }
  afterEach(() => {
    console.info = realInfo
    console.warn = realWarn
  })

  /** A session store that remembers what it is given, as the tab's does */
  const session = () => {
    const kept = new Map<string, string>()
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    }
  }

  const storage = (persisted: boolean, grants: boolean) => ({
    calls: [] as string[],
    async persisted() {
      this.calls.push('persisted')
      return persisted
    },
    async persist() {
      this.calls.push('persist')
      return grants
    },
  })

  it('does not ask, and says no, where the browser cannot', async () => {
    capture()
    const ask = persistentStorageRequester(null)
    expect(await ask()).to.equal(false)
    expect(await persistentStorageRequester({} as StorageManager)()).to.equal(false)
    expect(logged).to.deep.equal([])
  })

  it('says yes without asking when the data is already persistent', async () => {
    capture()
    const fake = storage(true, false)
    expect(await persistentStorageRequester(fake, session)()).to.equal(true)
    expect(fake.calls).to.deep.equal(['persisted'])
    expect(logged).to.deep.equal([])
  })

  it('asks, and says so, when it is granted', async () => {
    capture()
    const fake = storage(false, true)
    expect(await persistentStorageRequester(fake, session)('songs')).to.equal(true)
    expect(logged).to.deep.equal(['[Storage] Persistent storage granted (songs)'])
  })

  it('says it is best-effort when refused, and why installing helps', async () => {
    capture()
    const fake = storage(false, false)
    expect(await persistentStorageRequester(fake, session)()).to.equal(false)
    expect(String(logged[0])).to.contain('best-effort')
  })

  it('asks once for a page, however often it is asked', async () => {
    capture()
    const fake = storage(false, true)
    const ask = persistentStorageRequester(fake, session)
    const [first, second] = [ask(), ask()]
    expect(await first).to.equal(await second)
    await ask()
    expect(fake.calls).to.deep.equal(['persisted', 'persist'])
  })

  it('keeps the tab’s own session storage unless it is given another', async () => {
    capture()
    sessionStorage.removeItem('storage-persist-logged')
    try {
      await persistentStorageRequester(storage(false, true))()
      expect(sessionStorage.getItem('storage-persist-logged')).to.contain('granted')
    } finally {
      sessionStorage.removeItem('storage-persist-logged')
    }
  })

  it('says it once for a tab: not again for the next page of it', async () => {
    capture()
    const tab = session()
    await persistentStorageRequester(storage(false, true), () => tab)()
    await persistentStorageRequester(storage(false, true), () => tab)()
    expect(logged).to.have.length(1)
  })

  it('says it every time where the tab has no session storage', async () => {
    capture()
    const noSession = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    await persistentStorageRequester(storage(false, true), noSession)()
    await persistentStorageRequester(storage(false, true), noSession)()
    expect(logged).to.have.length(2)
  })

  it('says no, and why, when the browser fails', async () => {
    capture()
    const broken = {
      persisted: async () => {
        throw new Error('storage unavailable')
      },
      persist: async () => true,
    }
    expect(await persistentStorageRequester(broken, session)()).to.equal(false)
    expect(warned).to.have.length(1)
  })
})
