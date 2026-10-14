export const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
