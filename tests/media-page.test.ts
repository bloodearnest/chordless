import { expect, fixture, html } from '@open-wc/testing'
import type { MediaPage } from '../src/components/media-page.ts'
import { MediaSettingsChangeEvent } from '../src/components/media-player-settings.ts'
import { loadMediaSettings, saveMediaSettings } from '../src/js/media-settings.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/media-page.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('media-page', () => {
  const saved = loadMediaSettings()
  beforeEach(() => saveMediaSettings({ ...saved, mediaPlayerEnabled: true }))
  afterEach(() => saveMediaSettings(saved))

  const has = (el: MediaPage, selector: string) => el.shadowRoot?.querySelector(selector) !== null

  it('has the settings, and the pad sets while the player is on', async () => {
    const el = await fixture<MediaPage>(html`<media-page></media-page>`)
    expect(has(el, 'media-player-settings')).to.equal(true)
    expect(has(el, 'pad-set-manager')).to.equal(true)
  })

  it('shows no pad sets while the player is off, and again when it is switched on', async () => {
    saveMediaSettings({ ...saved, mediaPlayerEnabled: false })
    const el = await fixture<MediaPage>(html`<media-page></media-page>`)
    expect(has(el, 'media-player-settings')).to.equal(true)
    expect(has(el, 'pad-set-manager')).to.equal(false)
    expect(el.shadowRoot?.textContent).to.contain('The media player is off')

    el.dispatchEvent(new MediaSettingsChangeEvent({ ...saved, mediaPlayerEnabled: true }))
    await el.updateComplete
    expect(has(el, 'pad-set-manager')).to.equal(true)

    el.dispatchEvent(new MediaSettingsChangeEvent({ ...saved, mediaPlayerEnabled: false }))
    await el.updateComplete
    expect(has(el, 'pad-set-manager')).to.equal(false)
  })
})
