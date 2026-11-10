import { expect } from '@open-wc/testing'
import {
  askForDeferredFiles,
  startDeferredPrecache,
  type WorkerContainer,
} from '../src/js/precache-deferred.ts'

const { describe, it } = window

/** A worker that answers PRECACHE_DEFERRED on the port it is sent, or not at all */
function fakeWorker(reply: Record<string, unknown> | null) {
  const messages: unknown[] = []
  const worker = {
    postMessage(message: unknown, ports: MessagePort[]) {
      messages.push(message)
      if (reply) ports[0]?.postMessage(reply)
    },
  } as unknown as ServiceWorker
  return { worker, messages }
}

describe('fetching the deferred files', () => {
  it('asks the controlling worker, and gives its count', async () => {
    const { worker, messages } = fakeWorker({ success: true, done: 3, total: 4 })
    expect(await askForDeferredFiles({ controller: worker })).to.deep.equal({ done: 3, total: 4 })
    expect(messages).to.have.length(1)
    expect((messages[0] as { type: string }).type).to.equal('PRECACHE_DEFERRED')
  })

  it('has no one to ask without a worker in control', async () => {
    expect(await askForDeferredFiles({ controller: null })).to.equal(null)
  })

  it('takes a failed answer as no answer', async () => {
    const { worker } = fakeWorker({ success: false })
    expect(await askForDeferredFiles({ controller: worker })).to.equal(null)
  })

  it('waits for the page to settle before it asks', async () => {
    const { worker, messages } = fakeWorker({ success: true, done: 1, total: 1 })
    const container: WorkerContainer = {
      ready: Promise.resolve({ active: worker }),
      controller: worker,
    }
    let settled!: () => void
    const done = startDeferredPrecache(
      container,
      () => new Promise<void>(resolve => (settled = resolve))
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(messages).to.have.length(0)
    settled()
    expect(await done).to.deep.equal({ done: 1, total: 1 })
  })

  it('does not ask when the page is not under the worker, and does not wait for it', async () => {
    const { worker, messages } = fakeWorker({ success: true, done: 1, total: 1 })
    const container: WorkerContainer = {
      ready: Promise.resolve({ active: worker }),
      controller: null,
    }
    expect(await startDeferredPrecache(container, async () => {})).to.equal(null)
    expect(messages).to.have.length(0)
  })
})
