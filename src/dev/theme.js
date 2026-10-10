import { themeManager } from '/js/theme-manager.ts'

// Update display
function updateThemeDisplay() {
  document.getElementById('current-theme').textContent = themeManager.getCurrentTheme()
  document.getElementById('font-scale').textContent =
    themeManager.getVariable('font-scale') || '1.0'
}

// Initial update
updateThemeDisplay()

// Theme change observer
themeManager.addObserver(updateThemeDisplay)

// Toggle theme
document.getElementById('toggle-theme').addEventListener('click', () => {
  themeManager.toggleTheme()
})

// Set light theme
document.getElementById('set-light').addEventListener('click', () => {
  themeManager.setTheme('light')
})

// Set dark theme
document.getElementById('set-dark').addEventListener('click', () => {
  themeManager.setTheme('dark')
})

// Use system preference
document.getElementById('detect-system').addEventListener('click', () => {
  themeManager.setTheme('system')
  const systemTheme = themeManager.detectSystemPreference()
  alert(`Now following system preference (currently: ${systemTheme})`)
})

// Font scale functions (global for onclick)
window.setFontScale = scale => {
  themeManager.setFontScale(scale)
  updateThemeDisplay()
}
