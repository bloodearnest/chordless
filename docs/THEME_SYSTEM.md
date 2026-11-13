# Theme system

Colours, type and scale are CSS custom properties. They inherit through shadow DOM, so Lit components use
them without being told about the theme. `src/css/style.css` declares them (the light values on `:root`);
`src/js/theme-manager.ts` (`themeManager`, a singleton) holds the theme definitions, sets the variables on
`<html>`, saves the choice in `localStorage` and follows the system's light/dark preference. A playground
with every control is at `/dev/theme.html` (`just serve`).

## Using it

In a component's CSS, use the variables and never a literal colour:

```css
.panel { background: var(--bg-secondary); color: var(--text-color); border: 1px solid var(--border-color); }
```

Sizes come from the text size, so they follow the user's setting and the device:

```css
.note { font-size: var(--font-ui); padding: calc(var(--font-base) * 0.5); }
```

The variables (the full list, with both themes' values, is `ThemeManager.themes` and `style.css`):

- **Surfaces and text:** `--bg-color`, `--bg-secondary`, `--bg-tertiary`, `--text-color`, `--text-secondary`,
  `--text-tertiary`, `--text-muted`, `--border-color`, `--border-light`, `--panel-bg`, `--panel-border`.
- **Header and buttons:** `--header-bg`, `--header-text`, `--button-bg`, `--button-hover`, `--button-text`.
  The header is the same navy in light and dark on purpose.
- **State colours:** `--color-primary`, `--color-success`, `--color-warning`, `--color-danger`, `--color-info`.
- **The chart:** `--chord-color`, `--annotation-private-color` (pencil), `--annotation-shared-color` (ink:
  docs/ANNOTATIONS.md), `--sheet-background`, `--sheet-text`, `--sheet-notice` (a lead sheet drawn as music:
  docs/LEAD_SHEETS.md).
- **Overlays and dialogs:** `--overlay-bg`, `--overlay-light`, `--modal-backdrop`, `--modal-bg`, `--modal-border`,
  `--modal-shadow`, `--hover-bg`, `--active-bg`, `--focus-ring`.
- **Tints** (a wash of the current text colour, for rows and borders): `--tint-subtle`, `--tint`, `--tint-strong`,
  `--tint-border`.
- **Type:** `--font-family-base`, `--font-family-lyrics`, `--font-family-chords`, `--font-family-annotation`, and the sizes below.
- **Chord highlight:** `--chord-tint-bg` and `--chord-tint-ink`, set only while a tint is chosen (below).

## Text size

`--font-base-auto` is the device's choice: fluid between 16pt on a phone and 24pt on a tablet or desktop frame
(`clamp(16pt, min(3vw, 0.03 * var(--app-width)), 24pt)`). `--font-scale` is the user's own multiplier
(Preferences; `setFontScale`, 0.8 to 1.5, saved on the device). `--font-base` is their product, and the
semantic sizes derive from it: `--font-lyrics`, `--font-chords`, `--font-annotation`, `--font-ui`,
`--font-ui-small`, `--font-icon`. Spacing that should keep the device's proportions is built on
`--font-base-auto`, so a larger text setting does not eat the screen.

## Chord highlight and fonts

Preferences ("Chord Highlight and Fonts", `readability-settings.ts`) lets people put a tint behind the
chords (never the lyrics) and choose a typeface for the app, the lyrics and the chords separately. The
choices are stored on the device (`chord_tint`, `font_ui`, `font_lyrics`, `font_chords`:
`preferences.ts`) and `applyAppearance()` (`appearance.ts`) puts them on `<html>` as the variables above,
at once and without a reload. The theme manager calls it whenever it sets a theme, because a preset has a
pale colour for the light theme and a deep one for the dark (a colour of the reader's own is used in
both).

- `chord-tint.ts` has the presets and the contrast rule: the chord text keeps the theme's chord colour if
  it has 4.5:1 on the tint (WCAG AA), otherwise it is a dark or light ink that does.
- `fonts.ts` has the choices: stacks of fonts a device already has, never downloaded, so they work offline.
  (A bundled face such as Atkinson Hyperlegible would be a dependency added to `package.json`.)
- Chord styles read `var(--chord-tint-ink, var(--chord-color))` and put the tint on the `chord-display`
  inside `.chord`, so a chord that spills over the words after it is tinted too. A bar line and an invalid
  chord are not tinted.
- The settings panel draws a sample verse in the light and the dark theme side by side, from
  `ThemeManager.themes`, whichever theme is on.

## JavaScript

```ts
import { themeManager } from './theme-manager.ts'

themeManager.setTheme('dark')        // 'light', 'dark' or 'system' (follow the system)
themeManager.toggleTheme()           // Ctrl+Alt+M does the same
themeManager.getCurrentTheme()
themeManager.setFontScale(1.2)
themeManager.setVariable('chord-color', '#c0392b')
window.addEventListener('theme:change', e => { /* ThemeChangeEvent: theme, actualTheme */ })
```

`addObserver(fn)` / `removeObserver(fn)` are the same without an event. A component that draws on a canvas, or
otherwise cannot use a variable, listens for the change; everything else needs nothing. The theme manager is
loaded by its own early script in `index.html`, so the first paint is in the right theme.

## Adding to it

- **A variable:** declare it in `style.css` (light) and in both themes in `ThemeManager.themes`, then use it.
  Check it in both themes at `/dev/theme.html`.
- **A theme:** add an entry to `ThemeManager.themes` with every variable, and a button for it in the theme
  settings (`src/components/theme-settings.ts`).

## Troubleshooting

- *A variable does not update:* it must be set on `:root`/`<html>`, not on an element inside a shadow root, and
  the CSS must say `var(--name)`, not a copy of the value.
- *A shadow root ignores the theme:* an inherited property does not cross a `:host { all: initial }`.
- *The theme is not remembered:* `localStorage` can be blocked (a private window); the manager falls back to the
  system preference and logs a warning.
