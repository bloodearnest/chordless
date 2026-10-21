/**
 * The text of an error, or of whatever else was thrown. An OAuth error from Google (oauth4webapi's
 * ResponseBodyError) has the code and description Google gave, such as `invalid_client`, which its
 * message leaves out: they say what is wrong with the client, and hold no secret.
 */
export function message(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const { error: code, error_description: description } = error as {
    error?: unknown
    error_description?: unknown
  }
  if (typeof code !== 'string') return error.message
  return `${error.message}: ${code}${typeof description === 'string' ? ` (${description})` : ''}`
}

/**
 * The API is only for the app itself, served from the same origin, so there are no CORS
 * headers: browsers block cross-origin reads. Browsers also send some cross-origin requests
 * without a preflight (a POST with a text/plain body), so refuse those here by Origin and
 * Sec-Fetch-Site. Requests with neither header (curl, tests) are not browsers acting for a page.
 */
export function isCrossOrigin(request: Request, url: URL) {
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) return true
  const site = request.headers.get('Sec-Fetch-Site')
  return site !== null && site !== 'same-origin' && site !== 'none'
}

/**
 * Helper to return JSON responses
 */
export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

/** An answer to send as it is */
export class Refusal extends Error {
  status: number
  constructor(status: number, text: string) {
    super(text)
    this.status = status
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new Refusal(400, 'The body is not JSON')
  }
  if (!isRecord(body)) throw new Refusal(400, 'The body is not an object')
  return body
}
