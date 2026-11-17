import { expect, fixture, html } from '@open-wc/testing'
import type { SignInView } from '../src/js/views/sign-in-view.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/js/views/sign-in-view.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('sign-in-view', () => {
  it('has the page that signs in with an emailed link, under its heading', async () => {
    const view = await fixture<SignInView>(html`<sign-in-view></sign-in-view>`)
    expect(view.querySelector('app-header')?.getAttribute('heading')).to.equal('Sign in')
    expect(view.querySelector('sign-in-page')).to.not.equal(null)
  })
})
