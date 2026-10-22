import { expect, fixture, html } from '@open-wc/testing'
import type { MediaView } from '../src/js/views/media-view.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/js/views/media-view.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('media-view', () => {
  it('has the media player page, under its heading', async () => {
    const view = await fixture<MediaView>(html`<media-view></media-view>`)
    expect(view.querySelector('app-header')?.getAttribute('heading')).to.equal('Media player')
    expect(view.querySelector('media-page')).to.not.equal(null)
  })
})
