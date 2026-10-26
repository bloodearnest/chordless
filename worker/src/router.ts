/**
 * Routing for the Worker's HTTP requests: the auth API, share links, the dev pages, and
 * everything else from the static assets. A function of the request and the Worker's bindings, so
 * it runs in Node as well as in the Worker (`index.ts` passes in what only the Worker has).
 */

import type { Env } from './env.ts'
import type { GoogleApi } from './google-auth.ts'
import { isCrossOrigin, jsonResponse, message } from './http.ts'
import { handleOAuthCallback, handleSessionLogout, handleTokenRefresh } from './session.ts'
import { handleShareDownload, type ShareCache, shareFileId } from './share.ts'
import { handleShareLive, shareLiveId } from './share-live.ts'
import { withSharePreview } from './share-page.ts'
import type { TeamDeps } from './team-context.ts'
import { handleTeamRoutes, isTeamPath } from './team-routes.ts'

/** The Worker's API, which only the app's own pages may call */
const API_PATHS = /^\/(oauth|session|api)(\/|$)/

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  cache: ShareCache,
  google?: GoogleApi,
  team?: TeamDeps
) {
  const url = new URL(request.url)
  const path = url.pathname

  // (the API only: a share link's page, /s/<id>, is opened from other sites)
  if (API_PATHS.test(path) && isCrossOrigin(request, url)) {
    return jsonResponse({ error: 'Cross-origin requests are not allowed' }, 403)
  }

  try {
    // OAuth endpoints
    if (path === '/oauth/callback' && request.method === 'POST') {
      return await handleOAuthCallback(request, env, google)
    }

    // Token refresh endpoint
    if (path === '/session/refresh' && request.method === 'POST') {
      return await handleTokenRefresh(request, env, google)
    }

    // Signing out: the refresh token is revoked at Google
    if (path === '/session/logout' && request.method === 'POST') {
      return await handleSessionLogout(request, env, google)
    }

    // What the page needs that is set on the server (not secret: see Env)
    if (path === '/api/config' && request.method === 'GET') {
      return jsonResponse({ pickerApiKey: env.PICKER_API_KEY ?? null })
    }

    // Team spaces (docs/SPACES.md): making one, joining, its people, and its files
    if (isTeamPath(path)) return await handleTeamRoutes(request, env, team)

    // A device joining a share's live room (docs/LIVE_SYNC.md)
    const liveShareId = shareLiveId(path)
    if (liveShareId !== null) return await handleShareLive(request, liveShareId, env)

    // A share link's download (public, encrypted; see docs/SHARING.md)
    const shareId = shareFileId(path)
    if (shareId !== null) {
      return await handleShareDownload(request, shareId, env, {
        cache,
        waitUntil: promise => ctx.waitUntil(promise),
      })
    }

    // A share link opened as a page: the app, with a preview for whatever fetched it
    if (path.startsWith('/s/') && request.method === 'GET') {
      const page = await env.ASSETS.fetch(request)
      if (!page.headers.get('Content-Type')?.includes('text/html')) return page
      const headers = new Headers(page.headers)
      headers.set('X-Robots-Tag', 'noindex, nofollow')
      headers.delete('Content-Length')
      return new Response(withSharePreview(await page.text(), url.origin), {
        status: page.status,
        headers,
      })
    }

    // Dev-only component playgrounds (src/dev/). DEV_PAGES is set only in [env.dev]
    // in wrangler.toml (`npm run dev`). Routed here first via run_worker_first.
    if (path === '/dev' || path.startsWith('/dev/')) {
      if (!env.DEV_PAGES) {
        return new Response('Not Found', { status: 404 })
      }
      // The bare /dev (and /dev/) is the index of the pages: assets are served at the URL they
      // have (html_handling = "none"), so it would otherwise fall through to the app
      if (path === '/dev' || path === '/dev/') {
        return env.ASSETS.fetch(new Request(new URL('/dev/index.html', url), request))
      }
      return env.ASSETS.fetch(request)
    }

    // Not an API route — delegate to static assets (SPA fallback handles unknown paths)
    return env.ASSETS.fetch(request)
  } catch (error) {
    console.error('Worker error:', message(error), error)
    return jsonResponse({ error: 'Internal server error', message: message(error) }, 500)
  }
}
