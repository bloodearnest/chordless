/**
 * The device and browser facts (src/js/telemetry/device.ts): a class from the pointer and the screen,
 * not from the user agent, which an iPad sets to a Mac's.
 */
import { expect } from '@open-wc/testing'
import { baselineAttributes } from '../src/js/telemetry/baseline.ts'
import { deviceDetails } from '../src/js/telemetry/device.ts'

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
