/**
 * What every span of the page carries, added as it starts (docs/OBSERVABILITY.md): not set once as
 * resource attributes, because it changes while the page is open (being online, the page, the
 * session, the ids after a sign-in or a reset). Cost is per span and attributes are free, so more
 * here is cheap. Not the setlist or the song in view: those are on the spans that are about them.
 */
import type { Attributes } from '@opentelemetry/api'
import { getLive } from '../live.ts'
import { getAmbient } from './context.ts'
import { getDeviceId } from './ids.ts'

export function baselineAttributes(): Attributes {
  const attributes: Attributes = {}
  const set = (key: string, value: string | number | boolean | undefined | null) => {
    if (value !== undefined && value !== null) attributes[key] = value
  }
  const ambient = getAmbient()
  set('device.id', getDeviceId())
  set('enduser.pseudo.id', ambient.accountId)
  set('chordless.team.pseudo_id', ambient.teamPseudoId)
  set('chordless.space_kind', ambient.spaceKind)
  set('session.id', ambient.sessionId)
  // (the name of the page, not its address: the route's own words, like "setlist")
  set('chordless.route', document.body.dataset.view)
  set('chordless.live', getLive() !== null)
  set('chordless.online', navigator.onLine)
  set(
    'chordless.display_mode',
    window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'
  )
  return attributes
}
