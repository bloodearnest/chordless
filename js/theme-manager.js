/**
 * ThemeManager
 *
 * Centralized theme management using CSS Custom Properties.
 * Variables defined here are inherited into shadow DOM components.
 */

export class ThemeManager {
  constructor() {
    this.root = document.documentElement;
    this._currentTheme = null;
    this._observers = new Set();
  }

  /**
   * Theme definitions
   */
  static themes = {
    light: {
      // Background colors
      'bg-color': '#ffffff',
      'bg-secondary': '#f5f6f7',
      'bg-tertiary': '#ecf0f1',

      // Text colors
      'text-color': '#1a1a1a',
      'text-secondary': '#7f8c8d',
      'text-tertiary': '#95a5a6',
      'text-muted': '#bdc3c7',

      // Header colors
      'header-bg': '#2c3e50',
      'header-text': '#ecf0f1',

      // Button colors
      'button-bg': '#3498db',
      'button-hover': '#2980b9',
      'button-text': '#ffffff',

      // Accent colors
      'color-primary': '#3498db',
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
      'header-bg': '#242830',
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

      // Interactive states
      'hover-bg': 'rgba(255, 255, 255, 0.1)',
      'active-bg': 'rgba(255, 255, 255, 0.15)',
      'focus-ring': '#4da6ff',
    },
  };

  /**
   * Set a single CSS variable
   * @param {string} name - Variable name (without --)
   * @param {string} value - Variable value
   */
  setVariable(name, value) {
    this.root.style.setProperty(`--${name}`, value);
  }

  /**
   * Get a CSS variable value
   * @param {string} name - Variable name (without --)
   * @returns {string}
   */
  getVariable(name) {
    return getComputedStyle(this.root).getPropertyValue(`--${name}`).trim();
  }

  /**
   * Apply a complete theme
   * @param {string} themeName - 'light', 'dark', or 'system'
   */
  setTheme(themeName) {
    // Handle 'system' theme by detecting actual theme to apply
    let actualTheme = themeName;
    if (themeName === 'system') {
      actualTheme = this.detectSystemPreference();
    }

    const theme = ThemeManager.themes[actualTheme];
    if (!theme) {
      console.warn(`[ThemeManager] Unknown theme: ${actualTheme}`);
      return;
    }

    console.log(
      `[ThemeManager] Applying theme: ${themeName}${themeName === 'system' ? ` (${actualTheme})` : ''}`
    );

    // Apply all theme variables
    for (const [key, value] of Object.entries(theme)) {
      this.setVariable(key, value);
    }

    // Store current theme preference (may be 'system')
    this._currentTheme = themeName;

    // Save to localStorage
    try {
      localStorage.setItem('theme', themeName);
    } catch (e) {
      console.warn('[ThemeManager] Failed to save theme preference:', e);
    }

    // Notify observers
    this._notifyObservers(themeName);

    // Dispatch custom event for components that need it
    window.dispatchEvent(
      new CustomEvent('theme-change', {
        detail: { theme: themeName, actualTheme },
      })
    );
  }

  /**
   * Toggle between light and dark themes
   */
  toggleTheme() {
    const current = this.getCurrentTheme();
    const newTheme = current === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme);
  }

  /**
   * Get current theme name
   * @returns {string} - 'light', 'dark', or 'system'
   */
  getCurrentTheme() {
    return this._currentTheme || localStorage.getItem('theme') || 'system';
  }

  /**
   * Detect system preference for dark mode
   * @returns {string} - 'light' or 'dark'
   */
  detectSystemPreference() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  /**
   * Set font scale dynamically
   * @param {number} scale - Font scale multiplier (e.g., 1.0, 1.2)
   */
  setFontScale(scale) {
    this.setVariable('font-scale', scale);
  }

  /**
   * Update font scale based on container width (responsive)
   * @param {number} containerWidth - Width in pixels
   * @param {number} baseWidth - Base width for scale calculation (default: 1200)
   */
  updateResponsiveFontScale(containerWidth, baseWidth = 1200) {
    // Calculate scale factor: min 0.65, max 1.2
    const scale = Math.min(Math.max(containerWidth / baseWidth, 0.65), 1.2);
    this.setFontScale(scale);
  }

  /**
   * Set custom font family
   * @param {string} fontFamily - Font family CSS value
   */
  setFontFamily(fontFamily) {
    this.setVariable('font-family-base', fontFamily);

    try {
      localStorage.setItem('font-family', fontFamily);
    } catch (e) {
      console.warn('[ThemeManager] Failed to save font preference:', e);
    }
  }

  /**
   * Load and apply saved user preferences
   */
  loadPreferences() {
    // Load theme preference
    let savedTheme = null;
    try {
      savedTheme = localStorage.getItem('theme');
    } catch (e) {
      console.warn('[ThemeManager] Failed to load theme preference:', e);
    }

    // Use saved theme, or default to 'system'
    const theme = savedTheme || 'system';
    this.setTheme(theme);

    // Load font family preference
    try {
      const savedFontFamily = localStorage.getItem('font-family');
      if (savedFontFamily) {
        this.setFontFamily(savedFontFamily);
      }
    } catch (e) {
      console.warn('[ThemeManager] Failed to load font preference:', e);
    }

    // Load font scale preference
    try {
      const savedFontScale = localStorage.getItem('font-scale');
      if (savedFontScale) {
        this.setFontScale(parseFloat(savedFontScale));
      }
    } catch (e) {
      console.warn('[ThemeManager] Failed to load font scale preference:', e);
    }

    // Listen for system theme changes
    this._setupSystemThemeListener();
  }

  /**
   * Setup listener for system theme preference changes
   * @private
   */
  _setupSystemThemeListener() {
    if (window.matchMedia) {
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');

      darkModeQuery.addEventListener('change', e => {
        // Auto-switch if user preference is 'system'
        const userPreference = localStorage.getItem('theme');
        if (!userPreference || userPreference === 'system') {
          const newTheme = e.matches ? 'dark' : 'light';
          console.log(`[ThemeManager] System theme changed to ${newTheme}`);
          this.setTheme('system');
        }
      });
    }
  }

  /**
   * Add an observer to be notified of theme changes
   * @param {Function} callback - Called with (themeName) when theme changes
   */
  addObserver(callback) {
    this._observers.add(callback);
  }

  /**
   * Remove a theme change observer
   * @param {Function} callback
   */
  removeObserver(callback) {
    this._observers.delete(callback);
  }

  /**
   * Notify all observers of theme change
   * @private
   */
  _notifyObservers(themeName) {
    this._observers.forEach(callback => {
      try {
        callback(themeName);
      } catch (e) {
        console.error('[ThemeManager] Observer error:', e);
      }
    });
  }

  /**
   * Export current theme configuration
   * @returns {Object}
   */
  exportTheme() {
    const theme = this.getCurrentTheme();
    const config = ThemeManager.themes[theme];

    return {
      name: theme,
      variables: config,
      fontScale: this.getVariable('font-scale'),
      fontFamily: this.getVariable('font-family-base'),
    };
  }

  /**
   * Setup keyboard shortcuts for theme switching
   * @private
   */
  _setupKeyboardShortcuts() {
    window.addEventListener('keydown', e => {
      // Ctrl+L for Light mode
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        console.log('[ThemeManager] Keyboard shortcut: Switching to light mode');
        this.setTheme('light');
      }
      // Ctrl+D for Dark mode
      else if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        console.log('[ThemeManager] Keyboard shortcut: Switching to dark mode');
        this.setTheme('dark');
      }
    });
  }
}

// Singleton instance
export const themeManager = new ThemeManager();

// Auto-load preferences on module load
themeManager.loadPreferences();

// Setup keyboard shortcuts for testing
themeManager._setupKeyboardShortcuts();
