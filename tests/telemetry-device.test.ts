/**
 * The device and browser facts (src/js/telemetry/device.ts): a class from the pointer and the screen,
 * not from the user agent, which an iPad sets to a Mac's.
 */
import { expect } from '@open-wc/testing'
import { baselineAttributes } from '../src/js/telemetry/baseline.ts'
import { deviceDetails, parseUserAgent } from '../src/js/telemetry/device.ts'

const { describe, it, afterEach } = window

/** What the page's media queries, screen and navigator say, until `restore` */
interface Facts {
  coarse?: boolean
  fine?: boolean
  hover?: boolean
  standalone?: boolean
  screen?: [number, number]
  touchPoints?: number
  agentData?: object | null
}

const originals = {
  matchMedia: window.matchMedia,
  screen: Object.getOwnPropertyDescriptor(window, 'screen'),
  maxTouchPoints: Object.getOwnPropertyDescriptor(Navigator.prototype, 'maxTouchPoints'),
}

function pretend(facts: Facts): void {
  window.matchMedia = ((query: string) => {
    const on =
      (query.includes('pointer: coarse') && facts.coarse) ||
      (query.includes('pointer: fine') && facts.fine) ||
      (query.includes('hover: hover') && facts.hover) ||
      (query.includes('display-mode: standalone') && facts.standalone)
    return { matches: Boolean(on) } as MediaQueryList
  }) as typeof window.matchMedia
  const [width, height] = facts.screen ?? [1920, 1080]
  Object.defineProperty(window, 'screen', { configurable: true, value: { width, height } })
  Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
    configurable: true,
    get: () => facts.touchPoints ?? 0,
  })
  Object.defineProperty(navigator, 'userAgentData', {
    configurable: true,
    value: facts.agentData ?? undefined,
  })
}

afterEach(() => {
  window.matchMedia = originals.matchMedia
  if (originals.screen) Object.defineProperty(window, 'screen', originals.screen)
  if (originals.maxTouchPoints) {
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', originals.maxTouchPoints)
  }
  Reflect.deleteProperty(navigator, 'userAgentData')
})

describe('deviceDetails', () => {
  it('calls a finger-first device with a small screen a phone, whichever way it is held', () => {
    pretend({ coarse: true, screen: [844, 390], touchPoints: 5 })
    const phone = deviceDetails()
    expect(phone.deviceClass).to.equal('phone')
    expect(phone.pointer).to.equal('coarse')
    expect(phone.touchPoints).to.equal(5)
    // (upright, so turning it does not make a new screen)
    expect(phone.screen).to.equal('390x844')
  })

  it('calls a finger-first device with a big screen a tablet, though it says it is a Mac', () => {
    pretend({ coarse: true, screen: [1024, 1366], touchPoints: 5 })
    expect(deviceDetails().deviceClass).to.equal('tablet')
    // (the smallest iPad, 744 wide, is over the line)
    pretend({ coarse: true, screen: [744, 1133], touchPoints: 5 })
    expect(deviceDetails().deviceClass).to.equal('tablet')
  })

  it('calls anything with a mouse a desktop, even a laptop with a touch screen', () => {
    pretend({ fine: true, hover: true, screen: [1440, 900] })
    expect(deviceDetails().deviceClass).to.equal('desktop')
    expect(deviceDetails().pointer).to.equal('fine')
    pretend({ coarse: true, hover: true, screen: [1280, 800], touchPoints: 10 })
    expect(deviceDetails().deviceClass).to.equal('desktop')
  })

  it('says there is no pointer when the browser says neither', () => {
    pretend({})
    expect(deviceDetails().pointer).to.equal('none')
    expect(deviceDetails().touchPoints).to.equal(0)
  })

  it('says whether it is installed', () => {
    pretend({ standalone: true })
    expect(deviceDetails().displayMode).to.equal('standalone')
    pretend({})
    expect(deviceDetails().displayMode).to.equal('browser')
  })

  it('rounds the window to the nearest 50, so it is a size to group by', () => {
    pretend({})
    const [width, height] = deviceDetails().viewport.split('x').map(Number)
    expect(width % 50).to.equal(0)
    expect(height % 50).to.equal(0)
    expect(Math.abs(width - window.innerWidth)).to.be.at.most(25)
  })

  it('takes the browser, platform and mobile flag from the user agent data, without its padding', () => {
    pretend({
      agentData: {
        brands: [
          { brand: 'Not/A)Brand', version: '8' },
          { brand: 'Chromium', version: '120' },
        ],
        platform: 'macOS',
        mobile: false,
      },
    })
    const details = deviceDetails()
    expect(details.brands).to.deep.equal(['Chromium 120'])
    expect(details.platform).to.equal('macOS')
    expect(details.mobile).to.equal(false)
  })

  it('leaves them out where the browser has no user agent data (Safari, Firefox)', () => {
    pretend({})
    const details = deviceDetails()
    expect(details.brands).to.equal(undefined)
    expect(details.platform).to.equal(undefined)
    expect(details.mobile).to.equal(undefined)
  })
})

describe('the baseline attributes', () => {
  it('carry the device on every span', () => {
    pretend({
      coarse: true,
      screen: [820, 1180],
      touchPoints: 5,
      agentData: {
        brands: [{ brand: 'Chromium', version: '120' }],
        platform: 'Android',
        mobile: true,
      },
    })
    const attributes = baselineAttributes()
    expect(attributes['chordless.device_class']).to.equal('tablet')
    expect(attributes['chordless.touch_points']).to.equal(5)
    expect(attributes['chordless.touch']).to.equal(true)
    expect(attributes['browser.name']).to.be.a('string')
    expect(attributes['os.name']).to.be.a('string')
    expect(attributes['chordless.pointer']).to.equal('coarse')
    expect(attributes['chordless.hover']).to.equal(false)
    expect(attributes['chordless.screen']).to.equal('820x1180')
    expect(attributes['chordless.display_mode']).to.equal('browser')
    expect(attributes['browser.brands']).to.deep.equal(['Chromium 120'])
    expect(attributes['browser.platform']).to.equal('Android')
    expect(attributes['browser.mobile']).to.equal(true)
  })

  it('leave out what the browser does not say', () => {
    pretend({})
    const attributes = baselineAttributes()
    expect(attributes).to.not.have.property('browser.brands')
    expect(attributes).to.not.have.property('browser.platform')
    expect(attributes).to.not.have.property('browser.mobile')
  })
})

describe('parseUserAgent', () => {
  const cases: [string, string, number, string, string | undefined, string, string | undefined][] =
    [
      [
        'Safari on an iPhone',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        5,
        'Safari',
        '17',
        'iOS',
        '17',
      ],
      [
        'Chrome on an iPhone is still iOS',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
        5,
        'Chrome',
        '120',
        'iOS',
        '16',
      ],
      [
        'an iPad, which sends a Mac’s string',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        5,
        'Safari',
        '17',
        'iPadOS',
        undefined,
      ],
      [
        'a Mac',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        0,
        'Safari',
        '17',
        'macOS',
        undefined,
      ],
      [
        'Edge on Windows, not Chrome',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        0,
        'Edge',
        '120',
        'Windows',
        undefined,
      ],
      [
        'Chrome on Android',
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        5,
        'Chrome',
        '120',
        'Android',
        '10',
      ],
      [
        'Chrome on a Chromebook',
        'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        0,
        'Chrome',
        '120',
        'ChromeOS',
        undefined,
      ],
      [
        'Firefox on Linux',
        'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
        0,
        'Firefox',
        '121',
        'Linux',
        undefined,
      ],
    ]
  for (const [name, ua, touch, browser, browserVersion, os, osVersion] of cases) {
    it(`reads ${name}`, () => {
      const parsed = parseUserAgent(ua, touch)
      expect(parsed.browser.name).to.equal(browser)
      expect(parsed.browser.version).to.equal(browserVersion)
      expect(parsed.os.name).to.equal(os)
      expect(parsed.os.version).to.equal(osVersion)
    })
  }

  it('does not fail on a string it does not know', () => {
    expect(parseUserAgent('', 0)).to.deep.equal({
      browser: { name: 'other' },
      os: { name: 'other' },
    })
  })
})
