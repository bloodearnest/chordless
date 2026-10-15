import { expect, fixture, html } from '@open-wc/testing'
import type { ThemeSettings } from '../src/components/theme-settings.ts'
import { themeManager } from '../src/js/theme-manager.ts'
import { suppressConsoleLogs } from './test-helpers.ts'
import '../src/components/theme-settings.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

describe('theme-settings', () => {
  beforeEach(() => {
    localStorage.clear()
    themeManager.setTheme('light')
    themeManager.setFontScale(1)
  })
  afterEach(() => {
    localStorage.clear()
    themeManager.setTheme('light')
    themeManager.setFontScale(1)
  })

  const show = () => fixture<ThemeSettings>(html`<theme-settings></theme-settings>`)
  const button = (el: ThemeSettings, label: string) =>
    el.shadowRoot?.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
  const text = (el: ThemeSettings) => el.shadowRoot?.textContent?.replace(/\s+/g, ' ') ?? ''

  it('chooses the theme with its buttons, and follows the system', async () => {
    const el = await show()
    expect(button(el, 'Light theme').classList.contains('active')).to.equal(true)
    expect(text(el)).to.contain('System prefers:')
    expect(text(el)).to.not.contain('Following system preference')

    button(el, 'Dark theme').click()
    await el.updateComplete
    expect(themeManager.getCurrentTheme()).to.equal('dark')
    expect(button(el, 'Dark theme').classList.contains('active')).to.equal(true)

    button(el, 'Use system preference').click()
    await el.updateComplete
    expect(themeManager.getCurrentTheme()).to.equal('system')
    expect(button(el, 'Use system preference').classList.contains('active')).to.equal(true)
    expect(text(el)).to.contain('Following system preference')
    expect(text(el)).to.not.contain('System prefers:')
  })

  it('follows a theme changed elsewhere, while it is on the page', async () => {
    const el = await show()
    themeManager.setTheme('dark')
    await el.updateComplete
    expect(button(el, 'Dark theme').classList.contains('active')).to.equal(true)
    el.remove()
    themeManager.setTheme('light')
    expect(el._currentTheme).to.equal('dark')
  })

  it('takes a font scale of 100% when the theme gives none', async () => {
    const el = await show()
    themeManager.root.style.setProperty('--font-scale', 'none')
    themeManager.setTheme('dark')
    await el.updateComplete
    expect(el._fontScale).to.equal(1)
    themeManager.root.style.removeProperty('--font-scale')
  })

  it('sets the font scale with the slider, and keeps it', async () => {
    const el = await show()
    const slider = el.shadowRoot?.querySelector('.scale-slider') as HTMLInputElement
    slider.value = '1.5'
    slider.dispatchEvent(new Event('input'))
    await el.updateComplete
    expect(el._fontScale).to.equal(1.5)
    expect(localStorage.getItem('font-scale')).to.equal('1.5')
    expect(el.shadowRoot?.querySelector('.scale-value')?.textContent).to.equal('150%')
  })

  it('sets the font scale with the presets', async () => {
    const el = await show()
    const presets = [
      ...(el.shadowRoot?.querySelectorAll('.preset-button') ?? []),
    ] as HTMLButtonElement[]
    presets[0].click()
    expect(el._fontScale).to.equal(0.65)
    presets[3].click()
    expect(el._fontScale).to.equal(1.5)
    expect(localStorage.getItem('font-scale')).to.equal('1.5')
  })

  describe('where storage is blocked', () => {
    const realSet = Storage.prototype.setItem
    afterEach(() => {
      Storage.prototype.setItem = realSet
    })

    it('still sets the scale', async () => {
      const el = await show()
      Storage.prototype.setItem = () => {
        throw new Error('blocked')
      }
      const slider = el.shadowRoot?.querySelector('.scale-slider') as HTMLInputElement
      slider.value = '0.8'
      slider.dispatchEvent(new Event('input'))
      el.shadowRoot?.querySelector<HTMLButtonElement>('.preset-button')?.click()
      expect(el._fontScale).to.equal(0.65)
    })
  })
})
