/**
 * Failures made to order in the requests to Drive, for the real-Drive suite: a `fetch` that lets
 * calls through, counts them, and fails the next ones of a kind as it is told, as a network does
 * (the connection drops, or Drive answers 500).
 */

/** The kinds of call a history may make fail */
export const CALL_KINDS = ['list', 'read', 'status', 'create', 'update', 'changes'] as const
export type CallKind = (typeof CALL_KINDS)[number]

/** What kind of call a request to the Drive API is (null: not one that is made to fail) */
export function callKind(method: string, url: string): CallKind | null {
  const { pathname, searchParams } = new URL(url, 'https://www.googleapis.com')
  const path = pathname.replace(/^\/(upload\/)?drive\/v3/, '')
  if (/^\/changes$/.test(path)) return 'changes'
  if (/^\/files$/.test(path)) return method === 'GET' ? 'list' : method === 'POST' ? 'create' : null
  if (/^\/files\/[^/]+$/.test(path)) {
    if (method === 'PATCH') return 'update'
    if (method === 'GET') return searchParams.get('alt') === 'media' ? 'read' : 'status'
  }
  // (batch uploads, permissions and the rest go through)
  if (pathname.startsWith('/upload/') && method === 'POST') return 'create'
  return null
}

export interface FailureSpec {
  /** Fail the connection (otherwise Drive answers with `status`) */
  network: boolean
  status: number
  /** How many calls fail */
  times: number
  /** How many calls of the kind to let through first */
  skip: number
}

export function faultyFetch(inner: typeof fetch = (input, init) => fetch(input, init)) {
  const pending: (FailureSpec & { kind: CallKind })[] = []
  const counts: Record<string, number> = { requests: 0, injected: 0 }

  const faulty = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    counts.requests++
    const kind = callKind(method, url)
    const failure = kind ? pending.find(f => f.kind === kind) : undefined
    if (failure) {
      if (failure.skip > 0) failure.skip--
      else {
        if (--failure.times <= 0) pending.splice(pending.indexOf(failure), 1)
        counts.injected++
        if (failure.network) throw new TypeError('Failed to fetch (injected)')
        return new Response(
          JSON.stringify({
            error: { code: failure.status, message: `Injected ${failure.status}` },
          }),
          { status: failure.status, headers: { 'Content-Type': 'application/json' } }
        )
      }
    }
    return inner(input, init)
  }) as typeof fetch

  return {
    fetch: faulty,
    counts,
    fail(kind: CallKind, spec: FailureSpec) {
      pending.push({ kind, ...spec })
    },
    clear() {
      pending.length = 0
    },
  }
}
