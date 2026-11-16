/**
 * What kind of device an invitee is on, for the join page (docs/SPACES.md, "Setting up and joining a team
 * space"): the system, because a phone has a Google account on it and a laptop may not (and a Hotmail
 * user on Android who goes to Google's sign-up lands in the *device's* add-account flow), and whether the
 * page is open in the built-in browser of another app, where Google refuses to sign anyone in. Read from
 * the user agent, as telemetry does (`parseUserAgent`): an iPad says it is a Mac, and its touch points
 * tell it apart.
 */
import { parseUserAgent } from './telemetry/device.ts'

export type JoinOs = 'android' | 'ios' | 'other'

export interface JoinDevice {
  os: JoinOs
  /** The app whose built-in browser this is ("Facebook"), or null for a browser of its own */
  inAppBrowser: string | null
}

/** The apps that open a link in a browser of their own, which Google does not sign anyone in through */
const IN_APP_BROWSERS: [string, RegExp][] = [
  ['Facebook', /FBAN|FBAV|FB_IAB/],
  ['Instagram', /Instagram/],
  ['Line', /\bLine\//],
  ['WeChat', /MicroMessenger/],
  ['Snapchat', /Snapchat/],
  ['TikTok', /musical_ly|BytedanceWebview|TikTok/],
  ['LinkedIn', /LinkedInApp/],
  ['Twitter', /Twitter/],
  // (any Android WebView that says so: an app showing a page inside itself)
  ['another app', /; wv\)/],
]

export function joinDevice(
  userAgent: string = navigator.userAgent,
  touchPoints: number = navigator.maxTouchPoints
): JoinDevice {
  const system = parseUserAgent(userAgent, touchPoints).os.name
  const os: JoinOs =
    system === 'Android' ? 'android' : system === 'iOS' || system === 'iPadOS' ? 'ios' : 'other'
  const inApp = IN_APP_BROWSERS.find(([, pattern]) => pattern.test(userAgent))
  return { os, inAppBrowser: inApp ? inApp[0] : null }
}
