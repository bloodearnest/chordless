import { expect, fixture, html } from '@open-wc/testing'
import type { AccountView } from '../src/js/views/account-view.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/js/views/account-view.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('the Account and Teams view', () => {
  let uninstall: () => void
  beforeEach(() => {
    ;({ uninstall } = installFakeAuthWorker())
  })
  afterEach(() => uninstall())

  it('has the list of spaces under its heading', async () => {
    const view = await fixture<AccountView>(html`<account-view></account-view>`)
    expect(view.querySelector('app-header')?.getAttribute('heading')).to.equal('Account and Teams')
    expect(view.querySelector('account-page')).to.not.equal(null)
  })
})
