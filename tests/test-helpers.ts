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
