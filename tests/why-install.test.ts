import { expect, fixture, html } from '@open-wc/testing'
import { sendKeys } from '@web/test-runner-commands'
import type { AppModal } from '../src/components/app-modal.ts'
import type { WhyInstall } from '../src/components/why-install.ts'
import { A11Y } from './test-helpers.ts'
import '../src/components/why-install.ts'

const { describe, it } = window

describe('why-install', () => {
  const modalOf = (el: WhyInstall) => el.shadowRoot?.querySelector('app-modal') as AppModal
  const button = (el: WhyInstall) => el.shadowRoot?.querySelector('button') as HTMLButtonElement

  it('is a button that opens a popup with the reasons, and Escape closes it', async () => {
    const el = await fixture<WhyInstall>(html`<why-install></why-install>`)
    expect(button(el).textContent?.trim()).to.equal('Why install?')
    expect(modalOf(el).open).to.equal(false)

    button(el).click()
    await modalOf(el).updateComplete
    expect(modalOf(el).open).to.equal(true)
    const why = el.shadowRoot?.querySelector('.why')?.textContent ?? ''
    expect(why).to.include('Your songs stay put')
    expect(why).to.include('The whole screen for the song')
    expect(why).to.include('Feels like any other app you use')

    await sendKeys({ press: 'Escape' })
    expect(modalOf(el).open).to.equal(false)
  })

  it('is accessible', async () => {
    const el = await fixture<WhyInstall>(html`<why-install></why-install>`)
    await expect(el).to.be.accessible(A11Y)
  })
})

describe('why-install, on an iPhone or iPad', () => {
  const text = async (userAgent: string) => {
    Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
    try {
      const el = await fixture<WhyInstall>(html`<why-install></why-install>`)
      return modalOf(el).textContent
    } finally {
      delete (navigator as { userAgent?: string }).userAgent
    }
  }
  const modalOf = (el: WhyInstall) => el.shadowRoot?.querySelector('app-modal') as AppModal

  it('adds that the installed app keeps its own data, and not on other devices', async () => {
    expect(await text('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).to.contain(
      'keeps its own data'
    )
    expect(await text('Mozilla/5.0 (X11; Linux x86_64) Chrome/120')).to.not.contain(
      'keeps its own data'
    )
  })
})
