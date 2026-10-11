/** The theme was applied (sent on window): theme is the choice ('system', 'light', 'dark'), actualTheme what's shown */
export class ThemeChangeEvent extends Event {
  static readonly type = 'theme:change'
  readonly theme: string
  readonly actualTheme: string
  constructor(theme: string, actualTheme: string) {
    super(ThemeChangeEvent.type)
    this.theme = theme
    this.actualTheme = actualTheme
  }
}
/**
 * ThemeManager
 *
 * Centralized theme management using CSS Custom Properties.
 * Variables defined here are inherited into shadow DOM components.
 */

/** Called with the theme's name ('light', 'dark' or 'system') when it changes */
export type ThemeObserver = (themeName: string) => void

export class ThemeManager {
  root: HTMLElement
  _currentTheme: string | null
  _observers: Set<ThemeObserver>

  constructor() {
    this.root = document.documentElement
    this._currentTheme = null
    this._observers = new Set()
  }

  /**
   * Theme definitions
   */
  static themes: Record<string, Record<string, string>> = {
    light: {
      // Background colors
      'bg-color': '#ffffff',
      'bg-secondary': '#f5f6f7',
      'bg-tertiary': '#ecf0f1',

      // Text colors
      'text-color': '#1a1a1a',
      'text-secondary': '#5f6b6d',
      'text-tertiary': '#95a5a6',
      'text-muted': '#bdc3c7',

      // Header colors
      'header-bg': '#2c3e50',
      'header-text': '#ecf0f1',

      // Button colors
      'button-bg': '#2477ad',
      'button-hover': '#1f6a9a',
      'button-text': '#ffffff',

      // Accent colors
      'color-primary': '#2477ad',
      'color-success': '#27ae60',
      'color-warning': '#f39c12',
      'color-danger': '#e74c3c',
      'color-info': '#2980b9',
      'chord-color': '#2980b9',

      // Border colors
      'border-color': '#d5dbdb',
      'border-light': '#ecf0f1',

      // Overlay colors
      'overlay-bg': 'rgba(0, 0, 0, 0.7)',
      'overlay-light': 'rgba(0, 0, 0, 0.3)',

      // Modals: a white card, lifted by a darkened page and a drop shadow
      'modal-backdrop': 'rgba(0, 0, 0, 0.5)',
      'modal-bg': '#ffffff',
      'modal-border': 'transparent',
      'modal-shadow': '0 4px 20px rgba(0, 0, 0, 0.3)',

      // Settings panels (Preferences, Storage)
      'panel-bg': '#f5f6f7',
      'panel-border': '#e3e7ea',

      // Interactive states
      'hover-bg': 'rgba(255, 255, 255, 0.2)',
      'active-bg': 'rgba(255, 255, 255, 0.3)',
      'focus-ring': '#3498db',
    },

    dark: {
      // Background colors
      'bg-color': '#1a1a1a',
      'bg-secondary': '#2c2c2c',
      'bg-tertiary': '#333333',

      // Text colors
      'text-color': '#ecf0f1',
      'text-secondary': '#95a5a6',
      'text-tertiary': '#7f8c8d',
      'text-muted': '#566573',

      // Header colors
      'header-bg': '#2c3e50',
      'header-text': '#ecf0f1',

      // Button colors
      'button-bg': '#4da6ff',
      'button-hover': '#3498db',
      'button-text': '#ffffff',

      // Accent colors
      'color-primary': '#4da6ff',
      'color-success': '#2ecc71',
      'color-warning': '#f1c40f',
      'color-danger': '#e74c3c',
      'color-info': '#3498db',
      'chord-color': '#22d3ee',

      // Border colors
      'border-color': '#404040',
      'border-light': '#4d4d4d',

      // Overlay colors
      'overlay-bg': 'rgba(0, 0, 0, 0.8)',
      'overlay-light': 'rgba(0, 0, 0, 0.5)',

      // Modals: a shadow barely shows on a dark page, so the card is lighter
      // than the page, edged with a faint light border, over a darker backdrop
      'modal-backdrop': 'rgba(0, 0, 0, 0.7)',
      'modal-bg': '#242424',
      'modal-border': 'rgba(255, 255, 255, 0.12)',
      'modal-shadow': '0 8px 32px rgba(0, 0, 0, 0.6)',

      // Settings panels (Preferences, Storage)
      'panel-bg': '#2e2e2e',
      'panel-border': 'rgba(255, 255, 255, 0.12)',

      // Interactive states
      'hover-bg': 'rgba(255, 255, 255, 0.1)',
      'active-bg': 'rgba(255, 255, 255, 0.15)',
      'focus-ring': '#4da6ff',
    },
  }

  /**
   * Set a single CSS variable
   * @param name - Variable name (without --)
   * @param value - Variable value
   */
  setVariable(name: string, value: string | number): void {
    this.root.style.setProperty(`--${name}`, String(value))
  }

  /**
   * Get a CSS variable value
   * @param name - Variable name (without --)
   */
  getVariable(name: string): string {
    return getComputedStyle(this.root).getPropertyValue(`--${name}`).trim()
  }

  /**
   * Apply a complete theme
   * @param themeName - 'light', 'dark', or 'system'
   */
  setTheme(themeName: string): void {
    // Handle 'system' theme by detecting actual theme to apply
    let actualTheme = themeName
    if (themeName === 'system') {
      actualTheme = this.detectSystemPreference()
    }

    const theme = ThemeManager.themes[actualTheme]
    if (!theme) {
      console.warn(`[ThemeManager] Unknown theme: ${actualTheme}`)
      return
    }

    console.log(
      `[ThemeManager] Applying theme: ${themeName}${themeName === 'system' ? ` (${actualTheme})` : ''}`
    )

    // Apply all theme variables
    for (const [key, value] of Object.entries(theme)) {
      this.setVariable(key, value)
    }
    // So native controls (checkboxes, selects, date pickers, scrollbars) match
    this.root.style.colorScheme = actualTheme

    // Store current theme preference (may be 'system')
    this._currentTheme = themeName

    // Save to localStorage
    try {
      localStorage.setItem('theme', themeName)
    } catch (e) {
      console.warn('[ThemeManager] Failed to save theme preference:', e)
    }

    // Notify observers
    this._notifyObservers(themeName)

    // Update favicon to match theme
    this._updateFavicon(actualTheme)

    // Dispatch custom event for components that need it
    window.dispatchEvent(new ThemeChangeEvent(themeName, actualTheme))
  }

  /**
   * Update favicon to match the current theme
   * @private
   * @param theme - 'light' or 'dark'
   */
  _updateFavicon(theme: string): void {
    // Find existing favicon link or create one
    let faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]')

    if (!faviconLink) {
      faviconLink = document.createElement('link')
      faviconLink.rel = 'icon'
      faviconLink.type = 'image/svg+xml'
      document.head.appendChild(faviconLink)
    }

    // Update href based on theme
    const faviconPath = theme === 'dark' ? '/icons/favicon-dark.svg' : '/icons/favicon-light.svg'

    // Add cache-busting parameter to force browser to reload
    faviconLink.href = `${faviconPath}?t=${Date.now()}`
  }

  /**
   * Toggle between light and dark themes
   */
  toggleTheme(): void {
    const current = this.getCurrentTheme()
    const newTheme = current === 'light' ? 'dark' : 'light'
    this.setTheme(newTheme)
  }

  /**
   * Get current theme name
   * @returns 'light', 'dark', or 'system'
   */
  getCurrentTheme(): string {
    return this._currentTheme || localStorage.getItem('theme') || 'system'
  }

  /**
   * Detect system preference for dark mode
   * @returns 'light' or 'dark'
   */
  detectSystemPreference(): 'light' | 'dark' {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    return 'light'
  }

  /**
   * Set font scale dynamically
   * @param scale - Font scale multiplier (e.g., 1.0, 1.2)
   */
  setFontScale(scale: number): void {
    this.setVariable('font-scale', scale)
  }

  /**
   * Update font scale based on container width (responsive)
   * @param containerWidth - Width in pixels
   * @param baseWidth - Base width for scale calculation (default: 1200)
   */
  updateResponsiveFontScale(containerWidth: number, baseWidth = 1200): void {
    // Calculate scale factor: min 0.65, max 1.2
    const scale = Math.min(Math.max(containerWidth / baseWidth, 0.65), 1.2)
    this.setFontScale(scale)
  }

  /**
   * Set custom font family
   * @param fontFamily - Font family CSS value
   */
  setFontFamily(fontFamily: string): void {
    this.setVariable('font-family-base', fontFamily)

    try {
      localStorage.setItem('font-family', fontFamily)
    } catch (e) {
      console.warn('[ThemeManager] Failed to save font preference:', e)
    }
  }

  /**
   * Load and apply saved user preferences
   */
  loadPreferences(): void {
    // Load theme preference
    let savedTheme: string | null = null
    try {
      savedTheme = localStorage.getItem('theme')
    } catch (e) {
      console.warn('[ThemeManager] Failed to load theme preference:', e)
    }

    // Use saved theme, or default to 'system'
    const theme = savedTheme || 'system'
    this.setTheme(theme)

    // Load font family preference
    try {
      const savedFontFamily = localStorage.getItem('font-family')
      if (savedFontFamily) {
        this.setFontFamily(savedFontFamily)
      }
    } catch (e) {
      console.warn('[ThemeManager] Failed to load font preference:', e)
    }

    // Load font scale preference
    try {
      const savedFontScale = localStorage.getItem('font-scale')
      if (savedFontScale) {
        this.setFontScale(parseFloat(savedFontScale))
      }
    } catch (e) {
      console.warn('[ThemeManager] Failed to load font scale preference:', e)
    }

    // Listen for system theme changes
    this._setupSystemThemeListener()
  }

  /**
   * Setup listener for system theme preference changes
   * @private
   */
  _setupSystemThemeListener(): void {
    if (window.matchMedia) {
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')

      darkModeQuery.addEventListener('change', e => {
        // Auto-switch if user preference is 'system'
        const userPreference = localStorage.getItem('theme')
        if (!userPreference || userPreference === 'system') {
          const newTheme = e.matches ? 'dark' : 'light'
          console.log(`[ThemeManager] System theme changed to ${newTheme}`)
          this.setTheme('system')
        }
      })
    }
  }

  /**
   * Add an observer to be notified of theme changes
   * @param callback - Called with (themeName) when theme changes
   */
  addObserver(callback: ThemeObserver): void {
    this._observers.add(callback)
  }

  /**
   * Remove a theme change observer
   */
  removeObserver(callback: ThemeObserver): void {
    this._observers.delete(callback)
  }

  /**
   * Notify all observers of theme change
   * @private
   */
  _notifyObservers(themeName: string): void {
    this._observers.forEach(callback => {
      try {
        callback(themeName)
      } catch (e) {
        console.error('[ThemeManager] Observer error:', e)
      }
    })
  }

  /**
   * Export current theme configuration
   */
  exportTheme(): {
    name: string
    variables: Record<string, string> | undefined
    fontScale: string
    fontFamily: string
  } {
    const theme = this.getCurrentTheme()
    const config = ThemeManager.themes[theme]

    return {
      name: theme,
      variables: config,
      fontScale: this.getVariable('font-scale'),
      fontFamily: this.getVariable('font-family-base'),
    }
  }

  /**
   * Setup keyboard shortcuts for theme switching
   * @private
   */
  _setupKeyboardShortcuts(): void {
    window.addEventListener('keydown', e => {
      // Ctrl+L for Light mode
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault()
        console.log('[ThemeManager] Keyboard shortcut: Switching to light mode')
        this.setTheme('light')
      }
      // Ctrl+D for Dark mode
      else if (e.ctrlKey && e.key === 'd') {
        e.preventDefault()
        console.log('[ThemeManager] Keyboard shortcut: Switching to dark mode')
        this.setTheme('dark')
      }
    })
  }
}

// Singleton instance
export const themeManager = new ThemeManager()

// Auto-load preferences on module load
themeManager.loadPreferences()

// Setup keyboard shortcuts for testing
themeManager._setupKeyboardShortcuts()

declare global {
  interface GlobalEventHandlersEventMap {
    [ThemeChangeEvent.type]: ThemeChangeEvent
  }
}
