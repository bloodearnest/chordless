/**
 * What every span of the page carries, added as it starts (docs/OBSERVABILITY.md): not set once as
 * resource attributes, because it changes while the page is open (being online, the page, the
 * session, the ids after a sign-in or a reset). Cost is per span and attributes are free, so more
 * here is cheap. Not the setlist or the song in view: those are on the spans that are about them.
 */
import type { Attributes } from '@opentelemetry/api'
import {
  ATTR_DEVICE_ID,
  ATTR_ENDUSER_PSEUDO_ID,
  ATTR_SESSION_ID,
} from '@opentelemetry/semantic-conventions/incubating'
import { getLive } from '../live.ts'
import { getAmbient } from './context.ts'
import { deviceDetails } from './device.ts'
import { getDeviceId } from './ids.ts'

export function baselineAttributes(): Attributes {
  const attributes: Attributes = {}
  const set = (key: string, value: string | number | boolean | undefined | null) => {
    if (value !== undefined && value !== null) attributes[key] = value
  }
  const ambient = getAmbient()
  set(ATTR_DEVICE_ID, getDeviceId())
  set(ATTR_ENDUSER_PSEUDO_ID, ambient.accountId)
  set('chordless.team.pseudo_id', ambient.teamPseudoId)
  set('chordless.space_kind', ambient.spaceKind)
  set(ATTR_SESSION_ID, ambient.sessionId)
  // (the name of the page, not its address: the route's own words, like "setlist")
  set('chordless.route', document.body.dataset.view)
  set('chordless.live', getLive() !== null)
  set('chordless.online', navigator.onLine)
  const device = deviceDetails()
  set('chordless.display_mode', device.displayMode)
  set('chordless.device_class', device.deviceClass)
  set('chordless.touch', device.touch)
  set('chordless.touch_points', device.touchPoints)
  set('browser.name', device.browserName)
  set('browser.version', device.browserVersion)
  set('os.name', device.osName)
  set('os.version', device.osVersion)
  set('chordless.pointer', device.pointer)
  set('chordless.hover', device.hover)
  set('chordless.screen', device.screen)
  set('chordless.viewport', device.viewport)
  set('chordless.pixel_ratio', device.pixelRatio)
  set('browser.platform', device.platform)
  set('browser.mobile', device.mobile)
  if (device.brands?.length) attributes['browser.brands'] = device.brands
  return attributes
}
