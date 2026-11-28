import { expect, fixture, html, waitUntil } from '@open-wc/testing'
import '../src/components/sign-in-form.ts'
import { StepEvent } from '../src/components/email-code-sign-in.ts'
import type { SignInForm } from '../src/components/sign-in-form.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('sign-in-form', () => {
  it("says why Google's sign-in did not work, under its button, and lets it be tried again", async () => {
    const el = await fixture<SignInForm>(html`<sign-in-form></sign-in-form>`)
    el.google = async () => {
      throw new Error('access_denied')
    }
    el.shadowRoot?.querySelector<HTMLButtonElement>('button.google')?.click()
    await waitUntil(() => el.shadowRoot?.querySelector('.error'), 'the reason')
    // (a reason that is not one to show a person is put plainly)
    expect(el.shadowRoot?.querySelector('.error')?.textContent).to.contain('Signing in failed')
    expect(el.shadowRoot?.querySelector<HTMLButtonElement>('button.google')?.disabled).to.equal(
      false
    )
  })

  it("hides Google's sign-in while the emailed code is asked for, and shows it again for the address", async () => {
    const el = await fixture<SignInForm>(html`<sign-in-form></sign-in-form>`)
    const codeForm = el.shadowRoot?.querySelector('email-code-sign-in') as HTMLElement
    codeForm.dispatchEvent(new StepEvent(false))
    await el.updateComplete
    expect(el.shadowRoot?.querySelector('button.google')).to.equal(null)
    codeForm.dispatchEvent(new StepEvent(true))
    await el.updateComplete
    expect(el.shadowRoot?.querySelector('button.google')).to.not.equal(null)
  })
})
