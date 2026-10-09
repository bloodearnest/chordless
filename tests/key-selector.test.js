import { expect } from '@esm-bundle/chai'
import '../public/components/key-selector.js'

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

  /** Wait for the popover's toggle event to have run */
  const settle = () => new Promise(resolve => setTimeout(resolve))

  afterEach(() => selector?.remove())

  it('opens its popover below the button', async () => {
    await setUp()
    const button = selector.shadowRoot.querySelector('.picker-button')
    const popover = selector.shadowRoot.querySelector('.picker-popover')

    button.click()
    await settle()
    expect(popover.matches(':popover-open')).to.equal(true)
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
    expect(selector.shadowRoot.querySelector('.picker-popover').matches(':popover-open')).to.equal(
      false
    )
  })
})

describe('capo-selector', () => {
  let selector

  afterEach(() => selector?.remove())

  async function setUp({ value = 0, referenceKey = 'G', top = 10 } = {}) {
    await import('../public/components/capo-selector.js')
    selector = document.createElement('capo-selector')
    selector.value = value
    selector.referenceKey = referenceKey
    selector.editMode = true
    selector.style.cssText = `position: fixed; top: ${top}px; left: 20px`
    document.body.appendChild(selector)
    await selector.updateComplete
    return selector
  }

  const settle = () => new Promise(resolve => setTimeout(resolve))

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
})
