import { expect, fixture, html } from '@open-wc/testing'
import type { UsageReportsSetting } from '../src/components/usage-reports-setting.ts'
import { TelemetryPreferenceEvent } from '../src/js/preferences.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/usage-reports-setting.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const KEYS = ['telemetry', 'telemetry-device-id']

describe('usage-reports-setting', () => {
  beforeEach(() => {
    for (const key of KEYS) localStorage.removeItem(key)
  })
  afterEach(() => {
    for (const key of KEYS) localStorage.removeItem(key)
  })

  const show = () =>
    fixture<UsageReportsSetting>(html`<usage-reports-setting></usage-reports-setting>`)
  const control = <T extends HTMLElement>(el: UsageReportsSetting, selector: string) =>
    el.shadowRoot?.querySelector(selector) as T

  it('keeps the switch', async () => {
    const el = await show()
    control<HTMLInputElement>(el, '#toggle-telemetry').click()
    expect(localStorage.getItem('telemetry')).to.equal('false')
  })

  it('forgets the device id when turned off, as the privacy page does not run the app', async () => {
    const el = await show()
    expect(localStorage.getItem('telemetry-device-id')).to.not.equal(null)
    control<HTMLInputElement>(el, '#toggle-telemetry').click()
    expect(localStorage.getItem('telemetry-device-id')).to.equal(null)
  })

  it('shows the usage reports as on until turned off, and follows a change made elsewhere', async () => {
    const el = await show()
    expect(control<HTMLInputElement>(el, '#toggle-telemetry').checked).to.equal(true)
    window.dispatchEvent(new TelemetryPreferenceEvent(false))
    await el.updateComplete
    expect(control<HTMLInputElement>(el, '#toggle-telemetry').checked).to.equal(false)
    el.remove()
    window.dispatchEvent(new TelemetryPreferenceEvent(true))
    expect(el.telemetry).to.equal(false)
  })

  it('shows the start of this device’s report id, which Reset replaces, and not while reports are off', async () => {
    const el = await show()
    const id = el.shadowRoot?.querySelector('#support-id')?.textContent ?? ''
    expect(id).to.match(/^[0-9a-f]{8}$/)
    expect(localStorage.getItem('telemetry-device-id')?.startsWith(id)).to.equal(true)

    control<HTMLButtonElement>(el, '#reset-support-id').click()
    await el.updateComplete
    const after = el.shadowRoot?.querySelector('#support-id')?.textContent ?? ''
    expect(after).to.match(/^[0-9a-f]{8}$/)
    expect(after).to.not.equal(id)

    control<HTMLInputElement>(el, '#toggle-telemetry').click()
    await el.updateComplete
    expect(el.shadowRoot?.querySelector('#support-id')).to.equal(null)
  })

  it('copies the id, and carries on if the browser will not', async () => {
    const el = await show()
    const written: string[] = []
    const real = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    })
    try {
      control<HTMLButtonElement>(el, '#copy-support-id').click()
      await el.updateComplete
      expect(written).to.deep.equal([el.supportId])
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('refused')
          },
        },
      })
      control<HTMLButtonElement>(el, '#copy-support-id').click()
      await el.updateComplete
    } finally {
      if (real) Object.defineProperty(navigator, 'clipboard', real)
      else delete (navigator as unknown as Record<string, unknown>).clipboard
    }
  })
})
