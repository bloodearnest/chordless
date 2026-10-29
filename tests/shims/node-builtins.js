// What the browser unit tests give Node's `async_hooks` and `events` (web-test-runner.config.js): the
// Worker's tracing (worker/src/trace.ts) is imported by modules these tests load, and
// OpenTelemetry's context manager for Node imports them. Nothing here traces, so they only have to
// exist.
export class AsyncLocalStorage {
  run(_store, callback, ...args) {
    return callback(...args)
  }

  getStore() {
    return undefined
  }

  enterWith() {}
}

export class EventEmitter {}
