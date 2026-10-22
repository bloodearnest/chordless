import { expect, fixture, html } from '@open-wc/testing'
import type { NewTeamSpaceView } from '../src/js/views/new-team-space-view.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/js/views/new-team-space-view.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('new-team-space-view', () => {
  it('has the page that makes a team space, under its heading', async () => {
    const view = await fixture<NewTeamSpaceView>(html`<new-team-space-view></new-team-space-view>`)
    expect(view.querySelector('app-header')?.getAttribute('heading')).to.equal('New team space')
    expect(view.querySelector('team-space-wizard')).to.not.equal(null)
  })
})
