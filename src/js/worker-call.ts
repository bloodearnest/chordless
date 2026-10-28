/**
 * A call to the Worker's team routes (worker/src/team-routes.ts), as the page makes them: the
 * signed-in person's Google ID token as `Authorization: Bearer`, a JSON body if there is one, and
 * an answer that is not a success thrown as a `TeamError` with the reason the Worker gave.
 * `teamApi` (team-client.ts) and `TeamStorage` (storage/team-storage.ts) both call through this.
 */

/** An answer from the Worker that was not a success, with its HTTP status */
export class TeamError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'TeamError'
    this.status = status
  }
}

import { timedFetch } from './telemetry/telemetry.ts'

export interface WorkerCall {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** From the origin: `/api/...` */
  path: string
  query?: Record<string, string>
  body?: unknown
}

export interface WorkerConnection {
  /** The person's ID token for the Worker (docs/SPACES.md, "Setting up and joining") */
  token: () => Promise<string>
  /** Where the Worker is: the page's own origin */
  origin: string
  fetch: typeof fetch
}

/** The reason the Worker gave for a refusal (`{error}`), or the status text if it gave none */
async function reasonOf(response: Response): Promise<string> {
  try {
    const { error } = (await response.json()) as { error?: unknown }
    if (typeof error === 'string' && error) return error
  } catch {
    // (an answer that was not ours: the status text will do)
  }
  return response.statusText || `Error ${response.status}`
}

/**
 * Make a call to the Worker. Resolves with the response when it is a success; throws a
 * `TeamError` when it is not. `describe` may add to the reason (it is given the token sent).
 */
export async function callWorker(
  { method = 'GET', path, query, body }: WorkerCall,
  connection: WorkerConnection,
  describe?: (reason: string, status: number, token: string) => string
): Promise<Response> {
  const url = new URL(path, connection.origin)
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
  const token = await connection.token()
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  // (a span for the call, with its traceparent: the Worker's span is its child)
  const response = await timedFetch('worker', connection.fetch)(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.ok) return response
  const reason = await reasonOf(response)
  throw new TeamError(describe ? describe(reason, response.status, token) : reason, response.status)
}
