import { expect } from '@open-wc/testing'
import { themeManager } from '../src/js/theme-manager.ts'

const { describe, it, beforeEach, afterEach } = window

function press(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
}

describe('theme-manager keyboard shortcut', () => {
  beforeEach(() => {
    localStorage.clear()
    themeManager.setTheme('light')
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('Ctrl+Alt+M toggles between light and dark', () => {
    press({ ctrlKey: true, altKey: true, code: 'KeyM', key: 'm' })
    expect(themeManager.getCurrentTheme()).to.equal('dark')
    press({ ctrlKey: true, altKey: true, code: 'KeyM', key: 'µ' })
    expect(themeManager.getCurrentTheme()).to.equal('light')
  })

  it('from system, flips away from the resolved system theme', () => {
    themeManager.setTheme('system')
    const resolved = themeManager.detectSystemPreference()
    press({ ctrlKey: true, altKey: true, code: 'KeyM' })
    expect(themeManager.getCurrentTheme()).to.equal(resolved === 'dark' ? 'light' : 'dark')
  })

  it('Ctrl+L and Ctrl+D no longer change the theme', () => {
    press({ ctrlKey: true, code: 'KeyL', key: 'l' })
    press({ ctrlKey: true, code: 'KeyD', key: 'd' })
    expect(themeManager.getCurrentTheme()).to.equal('light')
  })

  it('ignores the shortcut while typing in an input', () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        altKey: true,
        code: 'KeyM',
      })
    )
    input.remove()
    expect(themeManager.getCurrentTheme()).to.equal('light')
  })
})
