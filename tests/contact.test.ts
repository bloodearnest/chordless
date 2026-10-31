/** What goes in the email to us (src/js/contact.ts) */
import { expect } from '@open-wc/testing'
import { CONTACT_ADDRESS, emailBody, emailLink, supportDetails } from '../src/js/contact.ts'
import type { DeviceDetails } from '../src/js/telemetry/device.ts'

const { describe, it } = window

const device: DeviceDetails = {
  deviceClass: 'tablet',
  touchPoints: 5,
  touch: true,
  browserName: 'Chrome',
  osName: 'Android',
  pointer: 'coarse',
  hover: false,
  screen: '820x1180',
  viewport: '800x1150',
  pixelRatio: 2,
  displayMode: 'standalone',
  brands: ['Chromium 120'],
  platform: 'Android',
  mobile: true,
}

const info = {
  supportId: 'abcd1234',
  version: '3f2a9c',
  device,
  online: true,
  userAgent: 'Mozilla/5.0 (test)',
}

describe('supportDetails', () => {
  it('lists the id, the version, the device and the browser, one to a line', () => {
    expect(supportDetails(info).split('\n')).to.deep.equal([
      'Support ID: abcd1234',
      'Version: 3f2a9c',
      'Device: tablet, coarse pointer, 5 touch points',
      'Screen: 820x1180 at 2x, window 800x1150',
      'Browser: Chromium 120 on Android',
      'Opened as: an installed app, online',
      'User agent: Mozilla/5.0 (test)',
    ])
  })

  it('says so when there is no id because reports are off, or no version yet', () => {
    const lines = supportDetails({ ...info, supportId: '', version: '' })
    expect(lines).to.contain('Support ID: none (usage reports are off)')
    expect(lines).to.contain('Version: unknown')
  })

  it('says the browser does not say, where it has no user agent data, and a page, and offline', () => {
    const lines = supportDetails({
      ...info,
      online: false,
      device: { ...device, brands: undefined, platform: undefined, displayMode: 'browser' },
    })
    expect(lines).to.contain('Browser: not said by this browser\n')
    expect(lines).to.contain('Opened as: a web page, offline')
  })
})

describe('emailBody', () => {
  it('puts the details under the message, after a line', () => {
    expect(emailBody('  It is slow.  ', 'Support ID: abcd1234')).to.equal(
      'It is slow.\n\n--\nDetails from Chordless, to help with this:\nSupport ID: abcd1234\n'
    )
  })

  it('is just the details when nothing was written', () => {
    expect(emailBody('   ', 'Support ID: abcd1234')).to.equal(
      '--\nDetails from Chordless, to help with this:\nSupport ID: abcd1234\n'
    )
  })
})

describe('emailLink', () => {
  it('is a mailto: where there is a share sheet, with the subject and body encoded', () => {
    const link = emailLink('Chordless', 'a & b\nc', true)
    expect(link).to.equal(`mailto:${CONTACT_ADDRESS}?subject=Chordless&body=a%20%26%20b%0Ac`)
  })

  it("is Gmail's compose window elsewhere, where mailto: does nothing without a mail app", () => {
    const link = new URL(emailLink('Chordless', 'a & b\nc', false))
    expect(link.origin).to.equal('https://mail.google.com')
    expect(link.searchParams.get('to')).to.equal(CONTACT_ADDRESS)
    expect(link.searchParams.get('su')).to.equal('Chordless')
    expect(link.searchParams.get('body')).to.equal('a & b\nc')
  })
})
