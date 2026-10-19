/**
 * Routing for the Worker's HTTP requests: the auth API, share links, the dev pages, and
 * everything else from the static assets. A function of the request and the Worker's bindings, so
 * it runs in Node as well as in the Worker (`index.ts` passes in what only the Worker has).
 */

import type { Env } from './env.ts'
import { isCrossOrigin, jsonResponse, message } from './http.ts'
import {
  type GoogleApi,
  handleOAuthCallback,
  handleSessionInvite,
  handleSessionLogout,
  handleSessionRevoke,
  handleTokenRefresh,
} from './session.ts'
import { handleShareDownload, type ShareCache, shareFileId } from './share.ts'
import { withSharePreview } from './share-page.ts'
import { handleSpikeDrive, handleSpikeEnable } from './spike-broker.ts'

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  cache: ShareCache,
  google?: GoogleApi
) {
  const url = new URL(request.url)
  const path = url.pathname

  if (
    (path.startsWith('/oauth/') ||
      path.startsWith('/session/') ||
      path.startsWith('/dev/spike/') ||
      path.startsWith('/api/share/')) &&
    isCrossOrigin(request, url)
  ) {
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

    // Session endpoints (require encrypted blob) - for future Drive collaboration features
    if (path === '/session/invite' && request.method === 'POST') {
      return await handleSessionInvite(request, env, google)
    }

    if (path === '/session/revoke' && request.method === 'POST') {
      return await handleSessionRevoke(request, env, google)
    }

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

    // The broker spike (docs/SPACES.md): dev only, throwaway
    if (path.startsWith('/dev/spike/') && request.method === 'POST') {
      if (!env.DEV_PAGES) return new Response('Not Found', { status: 404 })
      if (path === '/dev/spike/enable') return await handleSpikeEnable(request, env, google)
      if (path === '/dev/spike/drive') return await handleSpikeDrive(request, env, google)
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
    console.error('Worker error:', error)
    return jsonResponse({ error: 'Internal server error', message: message(error) }, 500)
  }
}
