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
    const button = selector.shadowRoot.querySelector('.key-selector')
    const popover = selector.shadowRoot.querySelector('.key-popover')

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
    const button = selector.shadowRoot.querySelector('.key-selector')
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
    selector.addEventListener('key-change', event => {
      chosen = event.detail.value
    })
    selector.shadowRoot.querySelector('.key-selector').click()
    await settle()
    const options = selector.shadowRoot.querySelectorAll('.key-option-item')
    options[2].click()
    expect(chosen).to.equal('E')
    expect(selector.shadowRoot.querySelector('.key-popover').matches(':popover-open')).to.equal(
      false
    )
  })
})
