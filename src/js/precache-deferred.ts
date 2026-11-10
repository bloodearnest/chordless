/**
 * Asks the service worker to fetch the heavy files it left out of its install (the PDF reader,
 * Verovio, the Help pictures: `DEFERRED` in vite-plugins/service-worker.ts), so that they work
 * offline too. It is done once the app has settled and the page is idle, so the first view, the
 * sign-in and the first sync are not slowed by it. The worker only fetches what it does not have,
 * so asking on every load costs nothing once they are kept, and after an update that changed them
 * it fills the gap. A failure is silent: the worker will be asked again the next time.
 */

/** What the page needs of the browser's service worker container */
export interface WorkerContainer {
  ready: Promise<{ active: ServiceWorker | null }>
  controller: ServiceWorker | null
}

export interface DeferredProgress {
  done: number
  total: number
}

/** How long after the app has loaded, once the page is idle, before the worker is asked */
const SETTLE_MS = 5000
/** The worker has several MB to fetch, and may be asked at a bad time: it is not waited on for ever */
const ANSWER_WITHIN_MS = 10 * 60 * 1000

/** Ask the controlling worker now; null if there is none, or it does not answer */
export function askForDeferredFiles(
  container: Pick<WorkerContainer, 'controller'> | undefined
): Promise<DeferredProgress | null> {
  const controller = container?.controller
  if (!controller) return Promise.resolve(null)
  return new Promise(resolve => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), ANSWER_WITHIN_MS)
    channel.port1.onmessage = (
      event: MessageEvent<{ success?: boolean; done?: number; total?: number }>
    ) => {
      clearTimeout(timer)
      const { success, done, total } = event.data
      resolve(success && done !== undefined && total !== undefined ? { done, total } : null)
    }
    controller.postMessage({ type: 'PRECACHE_DEFERRED', messageId: crypto.randomUUID() }, [
      channel.port2,
    ])
  })
}

/**
 * Wait until the page is under the worker's control and idle, then ask it. (On a first visit the
 * page is not controlled until the worker has installed and claimed it, or the page has reloaded
 * once: asking sooner would find no one to ask.)
 */
export async function startDeferredPrecache(
  container: WorkerContainer | undefined,
  settle: () => Promise<void> = settled
): Promise<DeferredProgress | null> {
  if (!container) return null
  await container.ready
  if (!container.controller) return null
  await settle()
  return askForDeferredFiles(container)
}

/* v8 ignore start -- timing and idleness: the tests give their own */
function settled(): Promise<void> {
  return new Promise(resolve => {
    const idle = () =>
      'requestIdleCallback' in window
        ? requestIdleCallback(() => resolve(), { timeout: 10000 })
        : setTimeout(resolve, 1000)
    setTimeout(idle, SETTLE_MS)
  })
}
/* v8 ignore stop */
