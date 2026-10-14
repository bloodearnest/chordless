const { beforeEach, afterEach } = window

/** Options for accessibility checks: expect(element).to.be.accessible(A11Y) */
export const A11Y = { ignoredRules: [] }

export function suppressConsoleLogs() {
  let originalLog
  let originalWarn
  let buffered

  beforeEach(() => {
    buffered = []
    originalLog = console.log
    originalWarn = console.warn
    console.log = (...args) => buffered.push({ type: 'log', args })
    console.warn = (...args) => buffered.push({ type: 'warn', args })
  })

  afterEach(function () {
    console.log = originalLog
    console.warn = originalWarn
    if (this.currentTest?.state === 'failed' && buffered?.length) {
      buffered.forEach(entry => {
        if (entry.type === 'log') {
          originalLog(...entry.args)
        } else {
          console[entry.type](...entry.args)
        }
      })
    }
  })
}

/** Wait ms (0 lets queued tasks and promise callbacks run) */
export const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export const settle = () => wait(0)

/** A unique name, so tests sharing the browser's IndexedDB do not meet each other's data */
export const uniqueName = () => crypto.randomUUID()

/** Delete an IndexedDB database, without waiting on connections left open */
export const deleteDatabase = (name: string) =>
  new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })

/** The organisation the sync tests run in */
export const TEST_ORG = { name: 'Test Church', id: 'org-test-church' }

/**
 * Fake setInterval/setTimeout (and their clears) that only move when the test says so, for code
 * that fades or waits in real time. `await clock.tick(ms)` runs every timer that falls due in
 * the next ms, in order, letting promises settle between them. Call `uninstall()` when done
 * (Mocha keeps its own references, so it is not affected while installed).
 */
export function installFakeTimers() {
  const real = {
    setInterval: window.setInterval,
    setTimeout: window.setTimeout,
    clearInterval: window.clearInterval,
    clearTimeout: window.clearTimeout,
  }
  type Timer = { at: number; every: number | null; callback: () => void }
  const timers = new Map<number, Timer>()
  let now = 0
  let nextId = 1

  const add = (callback: () => void, ms = 0, every: boolean) => {
    const id = nextId++
    timers.set(id, { at: now + ms, every: every ? Math.max(ms, 1) : null, callback })
    return id
  }
  const fake = window as unknown as Record<string, unknown>
  fake.setTimeout = (callback: () => void, ms?: number) => add(callback, ms, false)
  fake.setInterval = (callback: () => void, ms?: number) => add(callback, ms, true)
  fake.clearTimeout = fake.clearInterval = (id: number) => {
    timers.delete(id)
  }

  const settlePromises = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  return {
    /** How many timers are waiting to fire */
    get pending() {
      return timers.size
    },
    async tick(ms: number) {
      const end = now + ms
      await settlePromises()
      for (;;) {
        let due: [number, Timer] | null = null
        for (const entry of timers) {
          if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry
        }
        if (!due) break
        const [id, timer] = due
        now = timer.at
        if (timer.every === null) timers.delete(id)
        else timer.at += timer.every
        timer.callback()
        await settlePromises()
      }
      now = end
    },
    uninstall() {
      Object.assign(window, real)
    },
  }
}
