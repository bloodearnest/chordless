import { expect, fixture, html } from '@open-wc/testing'
import type { MediaPage } from '../src/components/media-page.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/media-page.ts'

const { describe, it } = window

suppressConsoleLogs()

describe('media-page', () => {
  it('has the media player settings, with uploading pad sets from the pad select', async () => {
    const el = await fixture<MediaPage>(html`<media-page></media-page>`)
    const settings = el.shadowRoot?.querySelector('media-player-settings')
    expect(settings).to.not.equal(null)
    expect(settings?.hasAttribute('uploads')).to.equal(true)
    expect(el.shadowRoot?.querySelector('pad-set-manager')).to.equal(null)
  })
})
