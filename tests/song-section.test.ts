import { expect } from '@open-wc/testing'
import '../src/components/song-section.ts'
import { A11Y } from './test-helpers.ts'

const { describe, it, afterEach } = window

describe('song-section', () => {
  let section

  async function setUp({ hideMode = 'none', isHidden = false, editMode = true } = {}) {
    section = document.createElement('song-section')
    section.label = 'Verse 1'
    section.lines = [{ segments: [{ chord: 'G', lyrics: 'Amazing grace' }] }]
    section.hideMode = hideMode
    section.isHidden = isHidden
    section.editMode = editMode
    document.body.appendChild(section)
    await section.updateComplete
    return section
  }

  const showButtons = () => [...section.shadowRoot.querySelectorAll('.section-controls button')]

  afterEach(() => section?.remove())

  it('shows its Show options as toggle buttons, pressed for the current one', async () => {
    await setUp({ hideMode: 'chords' })
    const group = section.shadowRoot.querySelector('.section-controls')
    expect(group.getAttribute('role')).to.equal('group')
    const pressed = showButtons().map(button => [
      button.textContent.trim(),
      button.getAttribute('aria-pressed'),
    ])
    expect(pressed).to.deep.equal([
      ['All', 'false'],
      ['Lyrics', 'true'],
      ['Chords', 'false'],
      ['None', 'false'],
    ])
    for (const button of showButtons()) {
      expect(button.hasAttribute('role'), button.textContent).to.equal(false)
      expect(button.hasAttribute('aria-checked'), button.textContent).to.equal(false)
    }
  })

  it('sends section-action for the option pressed', async () => {
    await setUp()
    let detail = null
    section.addEventListener('song-section:action', event => {
      detail = {
        songIndex: event.songIndex,
        sectionIndex: event.sectionIndex,
        action: event.action,
      }
    })
    showButtons()[3].click()
    expect(detail).to.deep.equal({ songIndex: 0, sectionIndex: 0, action: 'show-none' })
  })

  it('takes a hidden section out of the page, and so from screen readers, outside edit mode', async () => {
    await setUp({ isHidden: true, editMode: false })
    const wrapper = section.shadowRoot.querySelector('.song-section-wrapper')
    expect(getComputedStyle(wrapper).display).to.equal('none')
  })

  it('shows a hidden section in edit mode, to screen readers too', async () => {
    await setUp({ isHidden: true, editMode: true })
    const wrapper = section.shadowRoot.querySelector('.song-section-wrapper')
    expect(getComputedStyle(wrapper).display).to.not.equal('none')
    expect(wrapper.hasAttribute('aria-hidden')).to.equal(false)
  })

  it('is accessible, in and out of edit mode', async () => {
    // Known: the heading is a <summary> containing the collapse and Show
    // buttons (nested-interactive); restructuring it is in the TODO
    const a11y = { ignoredRules: [...A11Y.ignoredRules, 'nested-interactive'] }
    await setUp({ editMode: true })
    await expect(section).to.be.accessible(a11y)
    section.editMode = false
    await section.updateComplete
    await expect(section).to.be.accessible(a11y)
  })
})
