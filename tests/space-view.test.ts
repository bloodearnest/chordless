import { expect, fixture, html } from '@open-wc/testing'
import type { SpaceView } from '../src/js/views/space-view.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/js/views/space-view.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('space-view', () => {
  it('has the page of a space, with the route it was given', async () => {
    const view = await fixture<SpaceView>(html`<space-view></space-view>`)
    view.route = { name: 'space', spaceId: 'abc' }
    await view.updateComplete
    expect(view.querySelector('app-header')?.getAttribute('heading')).to.equal('Space')
    expect(view.querySelector('space-page')?.route).to.deep.equal({ name: 'space', spaceId: 'abc' })
  })
})
