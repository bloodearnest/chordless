import { expect } from '@open-wc/testing'
import { type InstallEnvironment, installModeFor } from '../src/js/install.ts'

const { describe, it } = window

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
// iPadOS reports itself as a Mac
const IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const MAC_SAFARI = IPAD
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0'

const env = (overrides: Partial<InstallEnvironment>): InstallEnvironment => ({
  standalone: false,
  hasPrompt: false,
  userAgent: FIREFOX,
  maxTouchPoints: 0,
  ...overrides,
})

describe('installModeFor', () => {
  it('says installed when it runs as an installed app, whatever the browser', () => {
    expect(installModeFor(env({ standalone: true, userAgent: IPHONE }))).to.equal('installed')
    expect(installModeFor(env({ standalone: true, hasPrompt: true }))).to.equal('installed')
  })

  it('offers the browser prompt when it has one', () => {
    expect(installModeFor(env({ hasPrompt: true, userAgent: MAC_CHROME }))).to.equal('prompt')
  })

  it('gives the Share instructions on an iPhone, and on an iPad that calls itself a Mac', () => {
    expect(installModeFor(env({ userAgent: IPHONE, maxTouchPoints: 5 }))).to.equal('ios')
    expect(installModeFor(env({ userAgent: IPAD, maxTouchPoints: 5 }))).to.equal('ios')
  })

  it('gives the Dock instructions in Safari on a Mac, which has no touch screen', () => {
    expect(installModeFor(env({ userAgent: MAC_SAFARI, maxTouchPoints: 0 }))).to.equal('mac-safari')
  })

  it('has nothing to offer in a browser that cannot install', () => {
    expect(installModeFor(env({ userAgent: FIREFOX }))).to.equal('none')
    // Chrome on a Mac without a prompt (already installed elsewhere, say) is not Safari
    expect(installModeFor(env({ userAgent: MAC_CHROME }))).to.equal('none')
  })
})
