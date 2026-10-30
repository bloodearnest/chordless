import { expect } from '@open-wc/testing'
import { ThemeChangeEvent, ThemeManager, themeManager } from '../src/js/theme-manager.ts'
import { suppressConsoleLogs } from './test-helpers.ts'

const { describe, it, beforeEach, afterEach } = window

suppressConsoleLogs()

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

describe('ThemeManager', () => {
  let manager: ThemeManager
  const realGet = Storage.prototype.getItem
  const realSet = Storage.prototype.setItem
  const realMatchMedia = window.matchMedia

  beforeEach(() => {
    localStorage.clear()
    manager = new ThemeManager()
  })
  afterEach(() => {
    Storage.prototype.getItem = realGet
    Storage.prototype.setItem = realSet
    window.matchMedia = realMatchMedia
    localStorage.clear()
    themeManager.setTheme('light')
    themeManager.setFontScale(1)
    document.documentElement.style.removeProperty('--font-family-base')
  })

  const blockStorage = () => {
    Storage.prototype.getItem = () => {
      throw new Error('blocked')
    }
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
  }

  describe('setTheme', () => {
    it('applies a theme, keeps it, and says so', () => {
      const events: ThemeChangeEvent[] = []
      const listener = (event: Event) => events.push(event as ThemeChangeEvent)
      window.addEventListener(ThemeChangeEvent.type, listener)
      const told: string[] = []
      manager.addObserver(name => told.push(name))
      try {
        manager.setTheme('dark')
      } finally {
        window.removeEventListener(ThemeChangeEvent.type, listener)
      }
      expect(manager.getVariable('bg-color')).to.not.equal('')
      expect(document.documentElement.style.colorScheme).to.equal('dark')
      expect(localStorage.getItem('theme')).to.equal('dark')
      expect(manager.getCurrentTheme()).to.equal('dark')
      expect(told).to.deep.equal(['dark'])
      expect(events.map(event => [event.theme, event.actualTheme])).to.deep.equal([
        ['dark', 'dark'],
      ])
    })

    it('takes the system to be dark when it says it prefers that', () => {
      window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia
      expect(manager.detectSystemPreference()).to.equal('dark')
      manager.setTheme('system')
      expect(document.documentElement.style.colorScheme).to.equal('dark')
    })

    it('applies the system theme as light or dark', () => {
      manager.setTheme('system')
      expect(manager.getCurrentTheme()).to.equal('system')
      expect(document.documentElement.style.colorScheme).to.equal(manager.detectSystemPreference())
    })

    it('does nothing for a theme it does not know', () => {
      manager.setTheme('purple')
      expect(localStorage.getItem('theme')).to.equal(null)
      expect(manager.getCurrentTheme()).to.equal('system')
    })

    it('still applies it when it cannot be saved', () => {
      blockStorage()
      manager.setTheme('dark')
      expect(document.documentElement.style.colorScheme).to.equal('dark')
    })

    it('makes the favicon for the theme, adding the link if there is none', () => {
      const link = document.querySelector('link[rel="icon"]')
      link?.remove()
      try {
        manager.setTheme('dark')
        expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).to.contain(
          'favicon-dark.svg'
        )
        manager.setTheme('light')
        expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).to.contain(
          'favicon-light.svg'
        )
      } finally {
        document.querySelector('link[rel="icon"]')?.remove()
        if (link) document.head.append(link)
      }
    })
  })

  describe('observers', () => {
    it('are told of changes until removed, and one that throws does not stop the rest', () => {
      const told: string[] = []
      const failing = () => {
        throw new Error('observer broke')
      }
      const counting = (name: string) => told.push(name)
      manager.addObserver(failing)
      manager.addObserver(counting)
      manager.setTheme('light')
      manager.removeObserver(counting)
      manager.setTheme('dark')
      expect(told).to.deep.equal(['light'])
    })
  })

  describe('the font', () => {
    it('has a scale kept within the range the slider offers', () => {
      manager.setFontScale(1.25)
      expect(manager.getVariable('font-scale')).to.equal('1.25')
      manager.setFontScale(0.1)
      expect(manager.getVariable('font-scale')).to.equal('0.8')
      manager.setFontScale(9)
      expect(manager.getVariable('font-scale')).to.equal('1.5')
    })

    it('has a family of its own, kept', () => {
      manager.setFontFamily('Georgia, serif')
      expect(manager.getVariable('font-family-base')).to.equal('Georgia, serif')
      expect(localStorage.getItem('font-family')).to.equal('Georgia, serif')
    })

    it('has a family even when it cannot be kept', () => {
      blockStorage()
      manager.setFontFamily('Georgia, serif')
      expect(manager.getVariable('font-family-base')).to.equal('Georgia, serif')
    })
  })

  describe('loading what was saved', () => {
    it('applies the theme, font family and font scale', () => {
      localStorage.setItem('theme', 'dark')
      localStorage.setItem('font-family', 'Georgia, serif')
      localStorage.setItem('font-scale', '1.25')
      manager.loadPreferences()
      expect(manager.getCurrentTheme()).to.equal('dark')
      expect(manager.getVariable('font-family-base')).to.equal('Georgia, serif')
      expect(manager.getVariable('font-scale')).to.equal('1.25')
    })

    it('follows the system when nothing was saved', () => {
      manager.loadPreferences()
      expect(manager.getCurrentTheme()).to.equal('system')
    })

    it('goes on with the defaults when storage cannot be read', () => {
      blockStorage()
      manager.loadPreferences()
      expect(document.documentElement.style.colorScheme).to.equal(manager.detectSystemPreference())
    })
  })

  describe('following the system', () => {
    function fakeSystemPreference() {
      let listener: ((event: { matches: boolean }) => void) | null = null
      window.matchMedia = (() => ({
        matches: false,
        addEventListener: (_type: string, callback: typeof listener) => {
          listener = callback
        },
      })) as unknown as typeof window.matchMedia
      return (matches: boolean) => listener?.({ matches })
    }

    it('changes the theme with the system when the preference is to follow it', () => {
      const change = fakeSystemPreference()
      manager._setupSystemThemeListener()
      manager.setTheme('light')
      localStorage.removeItem('theme')
      change(true)
      expect(manager.getCurrentTheme()).to.equal('system')
      localStorage.setItem('theme', 'system')
      manager.setTheme('light')
      localStorage.setItem('theme', 'system')
      change(false)
      expect(manager.getCurrentTheme()).to.equal('system')
    })

    it('leaves a theme that was chosen alone', () => {
      const change = fakeSystemPreference()
      manager._setupSystemThemeListener()
      manager.setTheme('light')
      change(true)
      expect(manager.getCurrentTheme()).to.equal('light')
    })
  })
})
