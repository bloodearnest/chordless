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
    // Washed, written in G: D4 to E5
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
    const noteOf = (key: string) => optionOf(key).querySelector('.range-note')

    it('marks each key with a mark, words and a tone, by how the melody fits it', async () => {
      await withRange(D4_TO_E5)
      const cases: [string, string, string, string][] = [
        ['A', 'tone-red', '✕', 'too high'], // F#5
        ['G', 'tone-yellow', '!', 'high'], // E5
        ['F', 'tone-yellow', '!', 'high'], // D5
        ['E', 'tone-green', '✓', ''], // C#5
        ['D', 'tone-yellow', '!', 'low'], // A3 at the bottom
      ]
      for (const [key, tone, mark, words] of cases) {
        const note = must(noteOf(key))
        expect(note.classList.contains(tone), key).to.equal(true)
        expect(must(note.querySelector('.range-mark')).textContent, key).to.equal(mark)
        expect(note.textContent?.replace(mark, '').trim(), key).to.equal(words)
      }
    })

    it('says it for a screen reader, with the key and its distance, and "in range" for a green one', async () => {
      await withRange(D4_TO_E5)
      expect(optionOf('A')?.getAttribute('aria-label')).to.equal('A +2, too high')
      expect(optionOf('E')?.getAttribute('aria-label')).to.equal('E -3, in range')
      // (the current key has no distance, so no gap in what is said)
      expect(optionOf('G')?.getAttribute('aria-label')).to.equal('G, high')
    })

    it('marks the key in use on the button, and says so in its label', async () => {
      await withRange(D4_TO_E5)
      const button = selector.shadowRoot.querySelector('.picker-button')
      const mark = must(button.querySelector('.range-mark'))
      expect(mark.textContent).to.equal('!')
      expect(mark.classList.contains('tone-yellow')).to.equal(true)
      expect(button.getAttribute('aria-label')).to.equal('Key: G, high')

      selector.value = 'E'
      await selector.updateComplete
      expect(button.getAttribute('aria-label')).to.equal('Key: E, in range')
    })

    it('names both ends when both are out of range', async () => {
      // G3 to F#5 in G: the top is red, the bottom is the edge
      await withRange({ low: 55, high: 78 })
      expect(noteOf('G')?.textContent).to.contain('too high, low')
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
      expect(selector.shadowRoot.querySelector('.range-note')).to.equal(null)
      expect(selector.shadowRoot.querySelector('.range-mark')).to.equal(null)
      expect(optionOf('A').hasAttribute('aria-label')).to.equal(false)
      expect(
        selector.shadowRoot.querySelector('.picker-button').getAttribute('aria-label')
      ).to.equal('Key: G')
      await withRange(D4_TO_E5, '')
      expect(selector.shadowRoot.querySelector('.range-note')).to.equal(null)
    })

    it('shows nothing for the current key when it is not among the keys', async () => {
      await withRange(D4_TO_E5)
      selector.value = '-'
      selector.keys = []
      await selector.updateComplete
      expect(selector.shadowRoot.querySelector('.picker-button .range-mark')).to.equal(null)
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
