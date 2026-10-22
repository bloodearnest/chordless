import { expect, fixture, html } from '@open-wc/testing'
import type { AccountSpaceView } from '../src/js/views/account-space-view.ts'
import type { AccountView } from '../src/js/views/account-view.ts'
import { installFakeAuthWorker } from './fake-auth-worker.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/js/views/account-space-view.ts'
import '../src/js/views/account-view.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('the Account and Teams views', () => {
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

  it('has one space’s page for the id in the route', async () => {
    const view = await fixture<AccountSpaceView>(
      html`<account-space-view .route=${{ name: 'account-space', spaceId: 'abc-1' }}></account-space-view>`
    )
    expect(view.querySelector('app-header')?.getAttribute('heading')).to.equal('Account and Teams')
    expect(view.querySelector<HTMLElement & { spaceId: string }>('space-page')?.spaceId).to.equal(
      'abc-1'
    )
  })

  it('has no space to show before it is given a route', async () => {
    const view = await fixture<AccountSpaceView>(html`<account-space-view></account-space-view>`)
    expect(view.querySelector<HTMLElement & { spaceId: string }>('space-page')?.spaceId).to.equal(
      ''
    )
  })
})
