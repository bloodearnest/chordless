import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import type { AppContact } from '../src/components/app-contact.ts'
import { CONTACT_ADDRESS } from '../src/js/contact.ts'
import { setTelemetryPreference } from '../src/js/preferences.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/app-contact.ts'

const { describe, it, beforeEach } = window

suppressConsoleLogs()

describe('app-contact', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  async function open(): Promise<AppContact> {
    const element = await fixture<AppContact>(html`<app-contact></app-contact>`)
    await element.updateComplete
    return element
  }

  const details = (element: AppContact) =>
    element.shadowRoot?.querySelector('#contact-details')?.textContent ?? ''
  const sendLink = (element: AppContact) =>
    element.shadowRoot?.querySelector<HTMLAnchorElement>('#contact-send')?.href ?? ''

  it('shows the Support ID, when reports are on, and the device', async () => {
    setTelemetryPreference(true)
    const element = await open()
    expect(details(element)).to.match(/Support ID: [0-9a-f]{8}\n/)
    expect(details(element)).to.contain('Device: ')
    expect(details(element)).to.contain('User agent: ')
  })

  it('says there is no id when reports are off', async () => {
    setTelemetryPreference(false)
    const element = await open()
    expect(details(element)).to.contain('Support ID: none (usage reports are off)')
  })

  it('puts what was written, then the details, in the email it starts', async () => {
    setTelemetryPreference(true)
    const element = await open()
    const box = element.shadowRoot?.querySelector<HTMLTextAreaElement>('#contact-message')
    if (!box) throw new Error('no message box')
    box.value = 'The chords are wrong in verse 2'
    box.dispatchEvent(new Event('input'))
    await element.updateComplete
    const link = new URL(sendLink(element))
    // (a mailto: with a share sheet, Gmail's compose window without: the body is a parameter of both)
    const body = link.searchParams.get('body')
    expect(body).to.match(/^The chords are wrong in verse 2\n\n--\n/)
    expect(body).to.contain('Support ID: ')
    expect(decodeURIComponent(link.href)).to.contain(CONTACT_ADDRESS)
  })

  it('copies the details, and says it did', async () => {
    const written: string[] = []
    const real = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => written.push(text) },
    })
    try {
      const element = await open()
      element.shadowRoot?.querySelector<HTMLButtonElement>('#contact-copy')?.click()
      await waitUntil(() => written.length === 1)
      expect(written[0]).to.equal(details(element))
      await element.updateComplete
      expect(element.shadowRoot?.querySelector('#contact-copy')?.textContent).to.contain('Copied')
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
      if (real) Object.defineProperty(Navigator.prototype, 'clipboard', real)
    }
  })

  it('is still usable when the browser will not copy', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('denied')
        },
      },
    })
    try {
      const element = await open()
      element.shadowRoot?.querySelector<HTMLButtonElement>('#contact-copy')?.click()
      await element.updateComplete
      expect(element.shadowRoot?.querySelector('#contact-copy')?.textContent).to.contain(
        'Copy the details'
      )
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})
