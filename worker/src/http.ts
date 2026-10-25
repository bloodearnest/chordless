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

/** A JSON answer */
export function jsonResponse(data: unknown, status = 200) {
  return Response.json(data, { status })
}

/** An answer to send as it is: thrown by a handler, and answered by `answering` */
export class Refusal extends Error {
  status: number
  constructor(status: number, text: string) {
    super(text)
    this.status = status
  }
}

/** The status to pass on for an error from further on (Drive, the storage): a 4xx it gave, else 502 */
function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && status < 500 ? status : 502
}

/**
 * Run a handler. A `Refusal` is answered with its status and text; anything else is logged
 * (under `label`) and answered with the 4xx status it carries, or 502.
 */
export async function answering(label: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof Refusal) return jsonResponse({ error: error.message }, error.status)
    console.error(`${label} error:`, message(error))
    return jsonResponse({ error: message(error) }, statusOf(error))
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
