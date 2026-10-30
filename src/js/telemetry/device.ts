/**
 * What kind of device and browser this is (docs/OBSERVABILITY.md, Identity): the touch and size
 * facts the user agent does not say. An iPad sends a Mac's user agent, and Chrome is trimming its own,
 * so the class, the screen and the pointer are asked for, not guessed from the string. Used for
 * every span (baseline.ts) and for the Contact page, so what we are told and what we record agree.
 */

export type DeviceClass = 'phone' | 'tablet' | 'desktop'

export interface DeviceDetails {
  deviceClass: DeviceClass
  /** `navigator.maxTouchPoints`: 0 with no touch screen */
  touchPoints: number
  /** The primary pointer: a finger (`coarse`), a mouse or trackpad (`fine`), or neither said */
  pointer: 'coarse' | 'fine' | 'none'
  hover: boolean
  /** The screen's width x height in CSS pixels, upright (the shorter side first, so rotation is not news) */
  screen: string
  /** The window's size in CSS pixels, to the nearest 50: a size to group by, not to follow someone */
  viewport: string
  pixelRatio: number
  displayMode: 'standalone' | 'browser'
  /** From `navigator.userAgentData` where the browser has it (Chromium): else undefined */
  brands?: string[]
  platform?: string
  mobile?: boolean
}

/** The part of `navigator.userAgentData` that is used (not in TypeScript's DOM types) */
interface UserAgentData {
  brands?: { brand: string; version: string }[]
  platform?: string
  mobile?: boolean
}

/** A phone's shorter side is under this many CSS pixels, a tablet's over (the smallest iPad is 744) */
const TABLET_MIN_SHORT_SIDE = 600

const matches = (query: string): boolean => window.matchMedia(query).matches

function nearest(value: number, step: number): number {
  return Math.round(value / step) * step
}

/** A phone, a tablet or a desktop: a finger-first device by its screen size, anything else a desktop */
function classify(coarse: boolean, hover: boolean, shortSide: number): DeviceClass {
  if (!coarse || hover) return 'desktop'
  return shortSide < TABLET_MIN_SHORT_SIDE ? 'phone' : 'tablet'
}

export function deviceDetails(): DeviceDetails {
  const coarse = matches('(pointer: coarse)')
  const fine = matches('(pointer: fine)')
  const hover = matches('(hover: hover)')
  const [short, long] = [screen.width, screen.height].sort((a, b) => a - b)
  const agent = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData
  return {
    deviceClass: classify(coarse, hover, short),
    touchPoints: navigator.maxTouchPoints ?? 0,
    pointer: coarse ? 'coarse' : fine ? 'fine' : 'none',
    hover,
    screen: `${short}x${long}`,
    viewport: `${nearest(window.innerWidth, 50)}x${nearest(window.innerHeight, 50)}`,
    pixelRatio: window.devicePixelRatio,
    displayMode: matches('(display-mode: standalone)') ? 'standalone' : 'browser',
    // ("Not A Brand" and its kind are padding the browser adds to stop sites matching on the list)
    brands: agent?.brands
      ?.filter(({ brand }) => !/not.?a.?brand/i.test(brand))
      .map(({ brand, version }) => `${brand} ${version}`),
    platform: agent?.platform,
    mobile: agent?.mobile,
  }
}
