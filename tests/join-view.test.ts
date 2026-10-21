import { expect, fixture, html } from '@open-wc/testing'
import type { JoinView } from '../src/js/views/join-view.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/js/views/join-view.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('join-view', () => {
  it('has the page that joins a team space, under its heading', async () => {
    const view = await fixture<JoinView>(html`<join-view></join-view>`)
    expect(view.querySelector('app-header')?.getAttribute('heading')).to.equal('Join a team space')
    expect(view.querySelector('team-join')).to.not.equal(null)
  })
})
