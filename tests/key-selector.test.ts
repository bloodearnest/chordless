import { expect } from '@open-wc/testing'
import '../src/components/key-selector.ts'
import { must } from './must.ts'
import { A11Y, settle } from './test-helpers.ts'

const { describe, it, afterEach } = window

describe('key-selector', () => {
  let selector

  async function setUp() {
    selector = document.createElement('key-selector')
    selector.keys = ['C', 'D', 'E', 'F', 'G']
    selector.value = 'C'
    selector.style.cssText = 'position: fixed; top: 10px; left: 20px'
    document.body.appendChild(selector)
    await selector.updateComplete
    return selector
  }

  /** Let the dialog's close event, and the renders it causes, run */

  afterEach(() => selector?.remove())

  it('opens its popover below the button', async () => {
    await setUp()
    const button = selector.shadowRoot.querySelector('.picker-button')
    const popover = selector.shadowRoot.querySelector('.picker-popover')

    button.click()
    await settle()
    expect(popover.open).to.equal(true)
    const rect = button.getBoundingClientRect()
    expect(Number.parseFloat(popover.style.top)).to.be.closeTo(rect.bottom + 4, 0.01)
    expect(Number.parseFloat(popover.style.left)).to.be.closeTo(rect.left, 0.01)
  })

  it('positions the popover once per opening, however often the key changed', async () => {
    await setUp()
    for (const key of ['D', 'E', 'F', 'G']) {
      selector.value = key
      await selector.updateComplete
    }
    const button = selector.shadowRoot.querySelector('.picker-button')
    let measured = 0
    const measure = button.getBoundingClientRect.bind(button)
    button.getBoundingClientRect = () => {
      measured++
      return measure()
    }

    button.click()
    await settle()
    expect(measured).to.equal(1)
  })

  it('sends key-change with the chosen key', async () => {
    await setUp()
    let chosen = null
    selector.addEventListener('key-selector:change', event => {
      chosen = event.value
    })
    selector.shadowRoot.querySelector('.picker-button').click()
    await settle()
    const options = selector.shadowRoot.querySelectorAll('.picker-option')
    options[2].click()
    expect(chosen).to.equal('E')
    expect(selector.shadowRoot.querySelector('.picker-popover').open).to.equal(false)
  })

  it('is accessible, in edit mode and with its options open', async () => {
    await setUp()
    selector.editMode = true
    await selector.updateComplete
    await expect(selector).to.be.accessible(A11Y)
    selector.shadowRoot.querySelector('.picker-button').click()
    await settle()
    await expect(selector).to.be.accessible(A11Y)
  })

  describe('the melody range', () => {
    // Washed, written in G: D4–E5
    const D4_TO_E5 = { low: 62, high: 76 }

    /** A key selector at G, with the keys as the app lists them: a semitone apart, the highest first */
    async function withRange(range: { low: number; high: number } | null, rangeKey = 'G') {
      selector = document.createElement('key-selector')
      selector.label = 'Key'
      selector.keys = ['Bb', 'A', 'Ab', 'G', 'F#', 'F', 'E', 'Eb', 'D']
      selector.value = 'G'
      selector.range = range
      selector.rangeKey = rangeKey
      document.body.appendChild(selector)
      await selector.updateComplete
      return selector
    }
    const optionOf = (key: string) =>
      [...selector.shadowRoot.querySelectorAll('.picker-option')].find(
        (option: Element) => option.querySelector('.option-label')?.textContent?.trim() === key
      )
    const noteOf = (key: string) => optionOf(key).querySelector('.range-badge')

    it('marks each key with a badge: a tone, and an icon that says which way, by how the melody fits it', async () => {
      await withRange(D4_TO_E5)
      // [key, tone, direction, triangles drawn, hover tip]
      const cases: [string, string, string, number, string][] = [
        ['A', 'tone-red', 'high', 2, 'too high'], // F#5: two stacked
        ['G', 'tone-yellow', 'high', 1, 'high'], // E5
        ['F', 'tone-yellow', 'high', 1, 'high'], // D5
        ['E', 'tone-green', 'none', 0, 'in range'], // C#5
        ['D', 'tone-yellow', 'low', 1, 'low'], // A3 at the bottom
      ]
      for (const [key, tone, direction, triangles, tip] of cases) {
        const badge = must(noteOf(key))
        expect(badge.classList.contains(tone), key).to.equal(true)
        expect(badge.getAttribute('data-direction'), key).to.equal(direction)
        expect(badge.querySelectorAll('polygon'), key).to.have.length(triangles)
        expect(badge.getAttribute('title'), key).to.equal(tip)
        expect(badge.getAttribute('aria-hidden'), key).to.equal('true')
      }
      // (a tick, not a triangle, for a key that fits)
      expect(noteOf('E')?.querySelector('path')).to.exist
    })

    it('draws an up and a down triangle when both ends are out', async () => {
      await withRange({ low: 55, high: 78 })
      expect(noteOf('G')?.getAttribute('data-direction')).to.equal('both')
      expect(noteOf('G')?.querySelectorAll('polygon')).to.have.length(2)
    })

    it('stacks two triangles down for a bottom that is too low, as two up for a top too high', async () => {
      // F#3–C5 in G: the bottom is red, the top fits
      await withRange({ low: 54, high: 72 })
      const badge = must(noteOf('G'))
      expect(badge.classList.contains('tone-red')).to.equal(true)
      expect(badge.getAttribute('data-direction')).to.equal('low')
      expect(badge.querySelectorAll('polygon')).to.have.length(2)
    })

    it('shows the lowest and highest note in each key, to say what the colour means', async () => {
      await withRange(D4_TO_E5)
      const notesOf = (key: string) => must(optionOf(key)?.querySelector('.option-notes'))
      expect(notesOf('A').textContent).to.equal('E4–F#5')
      expect(notesOf('G').textContent).to.equal('D4–E5')
      expect(notesOf('E').textContent).to.equal('B3–C#5')
      // spelled as the key spells them
      expect(notesOf('Eb').textContent).to.equal('Bb3–C5')
      expect(notesOf('F#').textContent).to.equal('C#4–D#5')
    })

    it('puts the note that is out of range in bold, and none when the key fits', async () => {
      await withRange(D4_TO_E5)
      const outOf = (key: string) =>
        [...(optionOf(key)?.querySelectorAll('.option-notes .out') ?? [])].map(e => e.textContent)
      expect(outOf('A')).to.deep.equal(['F#5']) // the top, too high
      expect(outOf('G')).to.deep.equal(['E5']) // the top, at the edge
      expect(outOf('D')).to.deep.equal(['A3']) // the bottom, at the edge
      expect(outOf('E')).to.deep.equal([])
      await withRange({ low: 55, high: 78 })
      expect(outOf('G')).to.deep.equal(['G3', 'F#5']) // both
    })

    it('takes a range printed an octave too high to the octave nearest the green, in every key', async () => {
      // Praise as SongSelect prints it, A4–A5 in A: the chart's own key and its neighbours
      await withRange({ low: 69, high: 81 }, 'A')
      const notesOf = (key: string) => must(optionOf(key)?.querySelector('.option-notes'))
      expect(notesOf('A').textContent).to.equal('A3–A4')
      expect(notesOf('G').textContent).to.equal('G3–G4')
      expect(notesOf('E').textContent).to.equal('E4–E5')
    })

    it('shows no notes when there is no range', async () => {
      await withRange(null)
      expect(selector.shadowRoot.querySelector('.option-notes')).to.equal(null)
    })

    it('draws every badge the same size, whatever it says', async () => {
      await withRange(D4_TO_E5)
      const sizes = ['A', 'G', 'E', 'D'].map(key => {
        const box = must(noteOf(key)).getBoundingClientRect()
        return `${Math.round(box.width)}x${Math.round(box.height)}`
      })
      expect(new Set(sizes).size).to.equal(1)
    })

    it('says it for a screen reader, with the key and its distance, and "in range" for a green one', async () => {
      await withRange(D4_TO_E5)
      expect(optionOf('A')?.getAttribute('aria-label')).to.equal('A +2, E4–F#5, too high')
      expect(optionOf('E')?.getAttribute('aria-label')).to.equal('E -3, B3–C#5, in range')
      // (the current key has no distance, so no gap in what is said)
      expect(optionOf('G')?.getAttribute('aria-label')).to.equal('G, D4–E5, high')
    })

    it('keeps the key in use plain on the button: the fit is for choosing a key, then out of the way', async () => {
      await withRange(D4_TO_E5)
      const button = selector.shadowRoot.querySelector('.picker-button')
      expect(button.querySelector('.range-badge')).to.equal(null)
      expect(button.getAttribute('aria-label')).to.equal('Key: G')
      // (the key in use is still marked in the list of keys, where it is looked at)
      expect(noteOf('G')).to.exist
      selector.value = 'E'
      await selector.updateComplete
      expect(button.querySelector('.range-badge')).to.equal(null)
      expect(button.getAttribute('aria-label')).to.equal('Key: E')
    })

    it('names both ends when both are out of range', async () => {
      // G3–F#5 in G: the top is red, the bottom is the edge
      await withRange({ low: 55, high: 78 })
      expect(noteOf('G')?.getAttribute('title')).to.equal('too high, low')
    })

    it('measures from the key the range is written in, not from the key in use', async () => {
      // the song is in G now; the chart (and the range) are in A, so G is two down: D5, the edge
      await withRange(D4_TO_E5, 'A')
      expect(noteOf('G')?.classList.contains('tone-yellow')).to.equal(true)
      expect(noteOf('A')?.classList.contains('tone-yellow')).to.equal(true)
      // F# is three down, C#5 at the top and B3 at the bottom: green
      expect(noteOf('F#')?.classList.contains('tone-green')).to.equal(true)
    })

    it('shows nothing when there is no range, or no key it is written in', async () => {
      await withRange(null)
      expect(selector.shadowRoot.querySelector('.range-badge')).to.equal(null)
      expect(optionOf('A').hasAttribute('aria-label')).to.equal(false)
      expect(
        selector.shadowRoot.querySelector('.picker-button').getAttribute('aria-label')
      ).to.equal('Key: G')
      await withRange(D4_TO_E5, '')
      expect(selector.shadowRoot.querySelector('.range-badge')).to.equal(null)
    })

    it('does not hide a red key: choosing it still works', async () => {
      await withRange(D4_TO_E5)
      let chosen = ''
      selector.addEventListener('key-selector:change', (event: any) => (chosen = event.value))
      selector.shadowRoot.querySelector('.picker-button').click()
      await settle()
      optionOf('A').click()
      expect(chosen).to.equal('A')
    })

    it('passes the accessibility checks with the marks shown', async () => {
      await withRange(D4_TO_E5)
      selector.shadowRoot.querySelector('.picker-button').click()
      await settle()
      await expect(selector).to.be.accessible(A11Y)
    })
  })
})

describe('capo-selector', () => {
  let selector

  afterEach(() => selector?.remove())

  async function setUp({ value = 0, referenceKey = 'G', top = 10 } = {}) {
    await import('../src/components/capo-selector.ts')
    selector = document.createElement('capo-selector')
    selector.value = value
    selector.referenceKey = referenceKey
    selector.editMode = true
    selector.style.cssText = `position: fixed; top: ${top}px; left: 20px`
    document.body.appendChild(selector)
    await selector.updateComplete
    return selector
  }

  it('offers capo 0 to 11, each with the key the chords are played in', async () => {
    await setUp()
    const options = [...selector.shadowRoot.querySelectorAll('.picker-option')]
    expect(options).to.have.length(12)
    expect(options[0].textContent.replace(/\s+/g, ' ').trim()).to.equal('0 G')
    expect(options[2].textContent.replace(/\s+/g, ' ').trim()).to.equal('2 F')
  })

  it('sends capo-change with the chosen capo, as a number', async () => {
    await setUp()
    let chosen = null
    selector.addEventListener('capo-selector:change', event => {
      chosen = event.value
    })
    selector.shadowRoot.querySelector('.picker-button').click()
    await settle()
    selector.shadowRoot.querySelectorAll('.picker-option')[3].click()
    expect(chosen).to.equal(3)
  })

  it('keeps its popover on screen when opened near the bottom', async () => {
    await setUp({ top: window.innerHeight - 60 })
    selector.shadowRoot.querySelector('.picker-button').click()
    await settle()
    const box = selector.shadowRoot.querySelector('.picker-popover').getBoundingClientRect()
    expect(box.top).to.be.at.least(0)
    expect(box.bottom).to.be.at.most(window.innerHeight)
  })

  it('is accessible', async () => {
    await setUp()
    await expect(selector).to.be.accessible(A11Y)
  })
})

describe('key-selector, with no key', () => {
  it('shows a dash for it', () => {
    const selector = document.createElement('key-selector')
    selector.value = ''
    expect(selector._displayValue()).to.equal('-')
    selector.value = 'G'
    expect(selector._displayValue()).to.equal('G')
  })
})
