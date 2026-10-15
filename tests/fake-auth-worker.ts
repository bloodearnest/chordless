import type { AuthMetadata, StoredBlob } from '../src/js/auth-db.ts'

/** The service worker's end of the sign-in: it keeps the blob and answers the page's messages */
export class FakeAuthWorker {
  stored: StoredBlob | undefined
  messages: { type: string; data: Record<string, unknown> }[] = []
  /** Types to answer with a failure, to see how the page copes */
  failing = new Set<string>()
  /** The invites and revokes it has been asked to queue */
  queued: Array<Record<string, unknown>> = []

  postMessage(
    { type, data, messageId }: { type: string; data: Record<string, unknown>; messageId: string },
    [port]: MessagePort[]
  ) {
    this.messages.push({ type, data })
    const reply = (response: object) => port.postMessage({ messageId, ...response })
    if (this.failing.has(type)) return reply({ success: false, error: 'worker failed' })
    switch (type) {
      case 'STORE_BLOB':
        this.stored = {
          blob: data.blob as string,
          metadata: data.metadata as AuthMetadata,
          updated_at: new Date().toISOString(),
        }
        return reply({ success: true })
      case 'GET_BLOB':
        return reply({ success: true, data: this.stored })
      case 'DELETE_BLOB':
        this.stored = undefined
        return reply({ success: true })
      case 'IMPORT_BLOB':
        this.stored = {
          blob: (data.backup as { blob: string }).blob,
          metadata: (data.backup as { metadata: AuthMetadata }).metadata,
          updated_at: new Date().toISOString(),
        }
        return reply({ success: true })
      case 'QUEUE_INVITE':
      case 'QUEUE_REVOKE':
        this.queued.push({ type, ...data })
        return reply({ success: true, operationId: this.queued.length })
      case 'GET_PENDING_OPERATIONS':
        return reply({ success: true, operations: this.queued })
      case 'PROCESS_QUEUE':
        return reply({ success: true })
      case 'EXPORT_BLOB':
        return this.stored
          ? reply({ success: true, backup: { version: 1, ...this.stored } })
          : reply({ success: false, error: 'No blob to export' })
      default:
        return reply({ success: false, error: `unknown message ${type}` })
    }
  }
}

/**
 * Make `worker` the page's service worker (what navigator.serviceWorker.controller is), so the
 * sign-in code talks to it. Call `uninstall()` when the test is done.
 */
export function installFakeAuthWorker(worker = new FakeAuthWorker()) {
  const descriptor = Object.getOwnPropertyDescriptor(ServiceWorkerContainer.prototype, 'controller')
  const setController = (controller: unknown) =>
    Object.defineProperty(navigator.serviceWorker, 'controller', {
      configurable: true,
      get: () => controller,
    })
  setController(worker)
  return {
    worker,
    /** Make the page have no service worker, as before the first one takes control */
    setController,
    uninstall() {
      // Put back the prototype's own getter
      delete (navigator.serviceWorker as { controller?: unknown }).controller
      if (descriptor)
        Object.defineProperty(ServiceWorkerContainer.prototype, 'controller', descriptor)
    },
  }
}
