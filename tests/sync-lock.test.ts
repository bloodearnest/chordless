import { expect } from '@open-wc/testing'
import { withSyncLock } from '../src/js/sync-lock.ts'

const { describe, it, beforeEach, afterEach } = window

/** A promise that is finished from outside */
function later() {
  let finish = () => {}
  const done = new Promise<void>(resolve => {
    finish = resolve
  })
  return { done, finish }
}

describe('One sync at a time', () => {
  // The lock is the whole origin's, and other test files sync in other tabs at the same time:
  // here it goes by a name of this test's own, so only these tests' syncs share it
  const realRequest = LockManager.prototype.request
  beforeEach(() => {
    const own = `chordless-sync-${crypto.randomUUID()}`
    LockManager.prototype.request = function (this: LockManager, name: string, ...rest: unknown[]) {
      return (realRequest as (...args: unknown[]) => Promise<unknown>).call(
        this,
        `${name}-${own}`,
        ...rest
      )
    } as LockManager['request']
  })
  afterEach(() => {
    LockManager.prototype.request = realRequest
  })

  it('runs the work and gives what it gave', async () => {
    expect(await withSyncLock(async () => 7)).to.deep.equal({ ran: true, value: 7 })
  })

  it('makes a second sync wait for the first', async () => {
    const order: string[] = []
    const first = later()
    const one = withSyncLock(async () => {
      order.push('first starts')
      await first.done
      order.push('first ends')
    })
    const two = withSyncLock(async () => {
      order.push('second')
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(order).to.deep.equal(['first starts'])
    first.finish()
    await Promise.all([one, two])
    expect(order).to.deep.equal(['first starts', 'first ends', 'second'])
  })

  it('skips a sync the app began by itself while another is running', async () => {
    const first = later()
    const one = withSyncLock(() => first.done)
    await new Promise(resolve => setTimeout(resolve, 20))
    let ran = false
    const skipped = await withSyncLock(
      async () => {
        ran = true
      },
      { skipIfBusy: true }
    )
    expect(skipped).to.deep.equal({ ran: false })
    expect(ran).to.equal(false)
    first.finish()
    await one
    expect((await withSyncLock(async () => 1, { skipIfBusy: true })).ran).to.equal(true)
  })

  it('just runs the work where there are no Web Locks', async () => {
    const locks = Object.getOwnPropertyDescriptor(Navigator.prototype, 'locks')
    Object.defineProperty(Navigator.prototype, 'locks', {
      configurable: true,
      get: () => undefined,
    })
    try {
      expect(await withSyncLock(async () => 3)).to.deep.equal({ ran: true, value: 3 })
    } finally {
      if (locks) Object.defineProperty(Navigator.prototype, 'locks', locks)
    }
  })
})
