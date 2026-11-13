import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chordColours,
  contrastRatio,
  inkOn,
  luminance,
  MIN_CONTRAST,
  normaliseTint,
  TINT_PRESETS,
  tintBackground,
} from '../src/js/chord-tint.ts'
import { FONT_CHOICES, fontFamily, normaliseFont } from '../src/js/fonts.ts'

const LIGHT_CHORD = '#1d6a9c'
const DARK_CHORD = '#22d3ee'

describe('contrast', () => {
  it('is 21 between black and white, 1 between a colour and itself', () => {
    assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21)
    assert.equal(contrastRatio('#fff4a3', '#fff4a3'), 1)
    assert.equal(luminance('#000000'), 0)
    assert.equal(luminance('#ffffff'), 1)
  })
})

describe('normaliseTint', () => {
  it('keeps a preset, or a colour of six hex digits in lower case, and drops anything else', () => {
    assert.equal(normaliseTint('yellow'), 'yellow')
    assert.equal(normaliseTint(' Cream '), 'cream')
    assert.equal(normaliseTint('#FFE08A'), '#ffe08a')
    for (const bad of ['', null, undefined, 'teal', '#fff', 'red; background: url(x)']) {
      assert.equal(normaliseTint(bad), '')
    }
  })
})

describe('tintBackground', () => {
  it('is nothing for no tint, and a preset has a colour for each theme', () => {
    assert.equal(tintBackground('', 'light'), null)
    for (const preset of TINT_PRESETS) {
      assert.equal(tintBackground(preset.id, 'light'), preset.light)
      assert.equal(tintBackground(preset.id, 'dark'), preset.dark)
    }
  })

  it('uses a colour of the readers own in both themes', () => {
    assert.equal(tintBackground('#ffe08a', 'light'), '#ffe08a')
    assert.equal(tintBackground('#ffe08a', 'dark'), '#ffe08a')
  })

  it('has pale presets for the light theme and deep ones for the dark', () => {
    for (const preset of TINT_PRESETS) {
      assert.ok(luminance(preset.light) > 0.6, `${preset.id} light`)
      assert.ok(luminance(preset.dark) < 0.15, `${preset.id} dark`)
    }
  })
})

describe('chord text on a tint', () => {
  it('keeps the themes chord colour where it reads', () => {
    assert.equal(inkOn('#ffffff', '#0b4a73'), '#0b4a73')
    assert.equal(inkOn('#1a1a1a', DARK_CHORD), DARK_CHORD)
  })

  it('keeps the light themes own chord colour on white and on every light preset', () => {
    assert.ok(contrastRatio(LIGHT_CHORD, '#ffffff') >= MIN_CONTRAST)
    for (const preset of TINT_PRESETS) {
      assert.equal(inkOn(preset.light, LIGHT_CHORD), LIGHT_CHORD, preset.id)
    }
  })

  it('is readable on every preset, in both themes', () => {
    for (const preset of TINT_PRESETS) {
      for (const [theme, chord] of [
        ['light', LIGHT_CHORD],
        ['dark', DARK_CHORD],
      ] as const) {
        const colours = chordColours(preset.id, theme, chord)
        assert.ok(colours, `${preset.id} ${theme}`)
        assert.ok(
          contrastRatio(colours.ink, colours.background) >= MIN_CONTRAST,
          `${preset.id} ${theme}: ${colours.ink} on ${colours.background}`
        )
      }
    }
  })

  it('is readable on any colour of the readers own', () => {
    for (const background of ['#000000', '#ffffff', '#808080', '#7f7fff', '#ff0000', '#00ff00']) {
      for (const chord of [LIGHT_CHORD, DARK_CHORD]) {
        const ink = inkOn(background, chord)
        // (mid greys cannot reach 4.5 with either; black or white is then the best there is)
        const best = Math.max(
          contrastRatio('#000000', background),
          contrastRatio('#ffffff', background)
        )
        assert.ok(contrastRatio(ink, background) >= Math.min(MIN_CONTRAST, best - 0.01))
      }
    }
  })

  it('changes the text on a tint the chord colour does not read on', () => {
    // cyan on a pale yellow is nearly invisible
    const ink = inkOn('#fff4a3', DARK_CHORD)
    assert.notEqual(ink, DARK_CHORD)
    assert.ok(contrastRatio(ink, '#fff4a3') >= MIN_CONTRAST)
  })

  it('does not trust a chord colour that is not a #rrggbb', () => {
    const ink = inkOn('#ffffff', 'var(--chord-color)')
    assert.ok(contrastRatio(ink, '#ffffff') >= MIN_CONTRAST)
  })

  it('falls back to white or black where neither ink reads', () => {
    assert.equal(inkOn('#717171', 'var(--chord-color)'), '#ffffff')
    assert.equal(inkOn('#808080', 'var(--chord-color)'), '#000000')
  })

  it('has no colours for no tint', () => {
    assert.equal(chordColours('', 'light', LIGHT_CHORD), null)
    assert.equal(chordColours('nonsense', 'dark', DARK_CHORD), null)
  })
})

describe('fonts', () => {
  it('has the app own font first, which changes nothing', () => {
    assert.equal(FONT_CHOICES[0]?.id, 'default')
    assert.equal(fontFamily('default'), null)
  })

  it('gives a font-family for each other choice, and falls back to a generic one', () => {
    for (const choice of FONT_CHOICES.slice(1)) {
      assert.match(fontFamily(choice.id) ?? '', /(sans-serif|serif|monospace)$/, choice.id)
    }
  })

  it('treats an unknown choice as the default', () => {
    assert.equal(normaliseFont('comic-papyrus'), 'default')
    assert.equal(normaliseFont(null), 'default')
    assert.equal(fontFamily('comic-papyrus'), null)
  })
})
