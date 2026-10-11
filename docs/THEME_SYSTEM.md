# Theme System Documentation

## Overview

The theme system provides centralized control over colors, typography, and scaling using **CSS Custom Properties (CSS Variables)**. These variables inherit through shadow DOM boundaries, making them perfect for Lit components.

## Features

✅ **Light/Dark mode support** - Pre-configured themes
✅ **Shadow DOM compatible** - Variables inherit into web components
✅ **Persistent** - Preferences saved to localStorage
✅ **Responsive** - Media query support for font scaling
✅ **Dynamic** - Update styles without re-rendering components
✅ **System preference detection** - Auto-detect dark mode preference
✅ **Observable** - Listen for theme changes
✅ **Type-safe** - Centralized variable definitions

## Quick Start

### 1. Theme Variables Available

All variables are defined in `/css/style.css` and managed by `/js/theme-manager.js`:

#### Colors

```css
--bg-color          /* Main background */
--bg-secondary      /* Secondary background */
--bg-tertiary       /* Tertiary background */
--text-color        /* Primary text */
--text-secondary    /* Secondary text */
--text-tertiary     /* Tertiary text */
--text-muted        /* Muted text */
--header-bg         /* Header background */
--header-text       /* Header text */
--button-bg         /* Button background */
--button-hover      /* Button hover state */
--button-text       /* Button text */
--color-primary     /* Primary accent */
--color-success     /* Success state */
--color-warning     /* Warning state */
--color-danger      /* Danger/error state */
--color-info        /* Info state */
--chord-color       /* Chord notation color */
--border-color      /* Border color */
--border-light      /* Light border */
--overlay-bg        /* Modal/overlay background */
--overlay-light     /* Light overlay */
--hover-bg          /* Hover background */
--active-bg         /* Active/pressed background */
--focus-ring        /* Focus ring color */
```

#### Typography

```css
--font-family-base  /* Base font family */
--font-scale        /* Responsive scaling multiplier */
```

### 2. Using Variables in Components

```javascript
// components/my-component.js
import { LitElement, html, css } from 'lit';

export class MyComponent extends LitElement {
  static styles = css`
    :host {
      /* Use theme variables */
      font-family: var(--font-family-base);
      color: var(--text-color);
      background: var(--bg-color);
    }

    .header {
      background: var(--header-bg);
      color: var(--header-text);
      /* Scale with viewport */
      font-size: calc(1.5rem * var(--font-scale));
    }

    .button {
      background: var(--button-bg);
      color: var(--button-text);
      border: 1px solid var(--border-color);
    }

    .button:hover {
      background: var(--button-hover);
    }

    /* Responsive spacing */
    .content {
      padding: calc(1rem * var(--font-scale));
    }
  `;

  render() {
    return html`
      <div class="header">
        <h1>My Component</h1>
      </div>
      <div class="content">
        <button class="button">Click Me</button>
      </div>
    `;
  }
}
```

### 3. JavaScript API

```javascript
import { themeManager } from '/js/theme-manager.js';

// Set theme
themeManager.setTheme('dark'); // or 'light' or 'system'
themeManager.setTheme('system'); // Follow system preference automatically
themeManager.toggleTheme(); // Toggle between light/dark

// Get current theme
const currentTheme = themeManager.getCurrentTheme(); // 'light', 'dark', or 'system'

// Detect system preference
const systemTheme = themeManager.detectSystemPreference(); // 'light' or 'dark'

// Set custom variable
themeManager.setVariable('my-color', '#ff0000');
themeManager.setVariable('my-spacing', '2rem');

// Get variable value
const primaryColor = themeManager.getVariable('color-primary');

// Font scaling
themeManager.setFontScale(1.2);

// Dynamic responsive scaling based on container width
themeManager.updateResponsiveFontScale(containerWidth, baseWidth);

// Custom font family
themeManager.setFontFamily('Georgia, serif');

// Observe theme changes
themeManager.addObserver(themeName => {
  console.log('Theme changed to:', themeName);
});

// Export theme configuration
const config = themeManager.exportTheme();
```

## Theme Definitions

### Light Theme

```javascript
{
  'bg-color': '#ffffff',
  'text-color': '#1a1a1a',
  'header-bg': '#2c3e50',
  'button-bg': '#3498db',
  // ... full definition in theme-manager.js
}
```

### Dark Theme

```javascript
{
  'bg-color': '#1a1a1a',
  'text-color': '#ecf0f1',
  'header-bg': '#34495e',
  'button-bg': '#4da6ff',
  // ... full definition in theme-manager.js
}
```

## Responsive Font Scaling

The `--font-scale` variable automatically adjusts based on viewport size:

```css
/* In css/style.css */
:root {
  --font-scale: 1.125; /* Default (tablet) */
}

/* Phone */
@media (max-width: 48rem) {
  :root {
    --font-scale: 0.65; /* Smaller for mobile */
  }
}

/* Desktop */
@media (min-width: 64rem) {
  :root {
    --font-scale: 1; /* Standard desktop */
  }
}
```

Use it in components:

```css
.text {
  font-size: calc(1rem * var(--font-scale));
  padding: calc(0.5rem * var(--font-scale));
}
```

## Adding a Theme Toggle Button

```javascript
import { themeManager } from '/js/theme-manager.js';

// In your nav menu or settings
const toggleButton = document.createElement('button');
toggleButton.textContent = 'Toggle Theme';
toggleButton.addEventListener('click', () => {
  themeManager.toggleTheme();
});
```

Or in a Lit component:

```javascript
render() {
  return html`
    <button @click=${this._toggleTheme}>
      ${this._currentTheme === 'dark' ? '☀️' : '🌙'}
    </button>
  `;
}

_toggleTheme() {
  themeManager.toggleTheme();
  this._currentTheme = themeManager.getCurrentTheme();
}

connectedCallback() {
  super.connectedCallback();
  this._currentTheme = themeManager.getCurrentTheme();

  // Listen for theme changes from other components
  this._themeObserver = (theme) => {
    this._currentTheme = theme;
    this.requestUpdate();
  };
  themeManager.addObserver(this._themeObserver);
}

disconnectedCallback() {
  super.disconnectedCallback();
  themeManager.removeObserver(this._themeObserver);
}
```

## Best Practices

### 1. Always use CSS variables for theming

```css
/* ✅ Good */
.element {
  color: var(--text-color);
  background: var(--bg-color);
}

/* ❌ Avoid */
.element {
  color: #1a1a1a;
  background: #ffffff;
}
```

### 2. Provide fallback values

```css
.element {
  color: var(--text-color, #1a1a1a);
}
```

### 3. Use calc() for responsive sizing

```css
.element {
  font-size: calc(1rem * var(--font-scale));
  padding: calc(0.5rem * var(--font-scale));
}
```

### 4. Listen for theme changes in components that need it

```javascript
connectedCallback() {
  super.connectedCallback();
  themeManager.addObserver(this._handleThemeChange);
}

disconnectedCallback() {
  super.disconnectedCallback();
  themeManager.removeObserver(this._handleThemeChange);
}
```

### 5. Initialize theme manager early

Theme manager auto-initializes when imported. Just import it once in your main script:

```javascript
import '/js/theme-manager.js';
```

## Demo

Visit `/theme-demo.html` to see the theme system in action with:

- Theme switching controls
- Color palette display
- Font scaling controls
- Usage examples
- JavaScript API examples

## Files

- `/js/theme-manager.js` - Theme management logic
- `/css/style.css` - CSS variable definitions
- `/theme-demo.html` - Interactive demo
- `THEME_SYSTEM.md` - This documentation

## Extending the System

### Adding New Themes

Edit `/js/theme-manager.js` and add to `ThemeManager.themes`:

```javascript
static themes = {
  light: { /* ... */ },
  dark: { /* ... */ },
  custom: {
    'bg-color': '#your-color',
    'text-color': '#your-color',
    // ...
  }
};
```

### Adding New Variables

1. Define default in `/css/style.css`:

```css
:root {
  --my-custom-var: #default-value;
}
```

2. Add to theme definitions in `/js/theme-manager.js`:

```javascript
light: {
  'my-custom-var': '#light-value',
},
dark: {
  'my-custom-var': '#dark-value',
}
```

3. Use in components:

```css
.element {
  border-color: var(--my-custom-var);
}
```

## Troubleshooting

### Variables not updating

- Check that theme-manager.js is imported
- Verify variable name matches (no typos)
- Check browser console for errors

### Shadow DOM not inheriting variables

CSS variables inherit by default. If not working:

- Ensure `:root` is used (not `body`)
- Check component is using `var(--name)` syntax
- Verify component has shadow DOM (`createRenderRoot()` not overridden)

### Theme not persisting

- Check localStorage is available (not in private browsing)
- Verify no JavaScript errors on page load
- Check browser console for theme-manager warnings
