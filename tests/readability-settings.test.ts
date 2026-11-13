import { expect, fixture, html } from '@open-wc/testing'
import type { ReadabilitySettings } from '../src/components/readability-settings.ts'
import { applyAppearance } from '../src/js/appearance.ts'
import { getChordTint, getFontChoice } from '../src/js/preferences.ts'
import { themeManager } from '../src/js/theme-manager.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/readability-settings.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

const KEYS = ['chord_tint', 'font_ui', 'font_lyrics', 'font_chords']
const reset = () => {
  for (const key of KEYS) localStorage.removeItem(key)
  themeManager.setTheme('light')
  applyAppearance()
}

describe('readability-settings', () => {
  beforeEach(reset)
  afterEach(reset)

  const show = () =>
    fixture<ReadabilitySettings>(html`<readability-settings></readability-settings>`)
  const root = document.documentElement
  const swatch = (el: ReadabilitySettings, label: string) =>
    el.shadowRoot?.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
  const select = (el: ReadabilitySettings, label: string) =>
    el.shadowRoot?.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
  const previews = (el: ReadabilitySettings) => [
    ...(el.shadowRoot?.querySelectorAll<HTMLElement>('.preview') ?? []),
  ]

  it('starts with no highlight, and the verse drawn in both themes', async () => {
    const el = await show()
    expect(swatch(el, 'No highlight').getAttribute('aria-pressed')).to.equal('true')
    expect(previews(el).map(p => p.dataset.theme)).to.deep.equal(['light', 'dark'])
    expect(root.style.getPropertyValue('--chord-tint-bg')).to.equal('')
    for (const preview of previews(el)) {
      expect(preview.style.getPropertyValue('--pv-tint')).to.equal('')
      expect(preview.textContent).to.not.contain('contrast')
    }
  })

  it('shows a choice in the light and the dark theme at once, whichever is on', async () => {
    const el = await show()
    swatch(el, 'Yellow highlight').click()
    await el.updateComplete
    const [light, dark] = previews(el)
    expect(light?.style.getPropertyValue('--pv-tint')).to.equal('#fff4a3')
    expect(dark?.style.getPropertyValue('--pv-tint')).to.equal('#5c5212')
    expect(light?.style.getPropertyValue('--pv-bg')).to.not.equal(
      dark?.style.getPropertyValue('--pv-bg')
    )
    expect(light?.textContent).to.match(/Chords read at \d+\.\d:1 contrast/)
  })

  it('tints the page at once, keeps the choice, and takes it off', async () => {
    const el = await show()
    swatch(el, 'Blue highlight').click()
    await el.updateComplete
    expect(getChordTint()).to.equal('blue')
    expect(root.style.getPropertyValue('--chord-tint-bg')).to.equal('#d6ecff')
    expect(root.style.getPropertyValue('--chord-tint-ink')).to.not.equal('')
    expect(swatch(el, 'Blue highlight').getAttribute('aria-pressed')).to.equal('true')

    swatch(el, 'No highlight').click()
    expect(getChordTint()).to.equal('')
    expect(root.style.getPropertyValue('--chord-tint-bg')).to.equal('')
    expect(root.style.getPropertyValue('--chord-tint-ink')).to.equal('')
  })

  it('uses the other colour of a preset when the theme changes', async () => {
    const el = await show()
    swatch(el, 'Green highlight').click()
    expect(root.style.getPropertyValue('--chord-tint-bg')).to.equal('#d8f5d0')
    themeManager.setTheme('dark')
    expect(root.style.getPropertyValue('--chord-tint-bg')).to.equal('#1f5a2a')
  })

  it('takes a colour of the readers own', async () => {
    const el = await show()
    const picker = el.shadowRoot?.querySelector('input[type=color]') as HTMLInputElement
    picker.value = '#ffe08a'
    picker.dispatchEvent(new Event('input'))
    await el.updateComplete
    expect(getChordTint()).to.equal('#ffe08a')
    expect(root.style.getPropertyValue('--chord-tint-bg')).to.equal('#ffe08a')
    themeManager.setTheme('dark')
    expect(root.style.getPropertyValue('--chord-tint-bg')).to.equal('#ffe08a')
  })

  it('chooses a font for the app, lyrics and chords each', async () => {
    const el = await show()
    const lyrics = select(el, 'Lyrics font')
    lyrics.value = 'clear'
    lyrics.dispatchEvent(new Event('change'))
    expect(getFontChoice('lyrics')).to.equal('clear')
    expect(getFontChoice('chords')).to.equal('default')
    expect(getFontChoice('ui')).to.equal('default')
    expect(root.style.getPropertyValue('--font-family-lyrics')).to.contain('Verdana')
    expect(root.style.getPropertyValue('--font-family-chords')).to.equal('')
    expect(root.style.getPropertyValue('--font-family-base')).to.equal('')

    const chords = select(el, 'Chords font')
    chords.value = 'mono'
    chords.dispatchEvent(new Event('change'))
    expect(root.style.getPropertyValue('--font-family-chords')).to.contain('monospace')

    const app = select(el, 'App font')
    app.value = 'serif'
    app.dispatchEvent(new Event('change'))
    expect(root.style.getPropertyValue('--font-family-base')).to.contain('Georgia')

    lyrics.value = 'default'
    lyrics.dispatchEvent(new Event('change'))
    expect(root.style.getPropertyValue('--font-family-lyrics')).to.equal('')
  })

  it('ignores a stored value that is not a choice', async () => {
    localStorage.setItem('chord_tint', 'teal; color: red')
    localStorage.setItem('font_chords', 'papyrus')
    applyAppearance()
    const el = await show()
    expect(swatch(el, 'No highlight').getAttribute('aria-pressed')).to.equal('true')
    expect(select(el, 'Chords font').value).to.equal('default')
    expect(root.style.getPropertyValue('--chord-tint-bg')).to.equal('')
    expect(root.style.getPropertyValue('--font-family-chords')).to.equal('')
  })

  it('follows a choice made elsewhere while on the page', async () => {
    const el = await show()
    const { setChordTint } = await import('../src/js/preferences.ts')
    setChordTint('pink')
    await el.updateComplete
    expect(swatch(el, 'Pink highlight').getAttribute('aria-pressed')).to.equal('true')
  })
})
