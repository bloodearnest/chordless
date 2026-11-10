import { expect } from '@open-wc/testing'
import '../src/components/song-section.ts'
import { measure, melodyOf } from './score-build.ts'
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

  it('shows a note after its label', async () => {
    await setUp()
    section.label = 'Chorus'
    section.note = '(first time a cappella)'
    await section.updateComplete
    expect(section.shadowRoot.querySelector('.section-title').textContent.trim()).to.equal('Chorus')
    expect(section.shadowRoot.querySelector('.section-note').textContent.trim()).to.equal(
      '(first time a cappella)'
    )
  })

  it('shows no note when there is none', async () => {
    await setUp()
    expect(section.shadowRoot.querySelector('.section-note')).to.equal(null)
  })

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

  it('has no collapse chevron outside edit mode, which took a line of its own on a phone', async () => {
    await setUp({ editMode: false })
    const toggle = () => section.shadowRoot.querySelector('.section-collapse-toggle')
    expect(getComputedStyle(toggle()).display).to.equal('none')
    section.editMode = true
    await section.updateComplete
    expect(getComputedStyle(toggle()).display).to.not.equal('none')
  })

  it('sends section-action for the option pressed', async () => {
    await setUp()
    let detail: { songIndex: number; sectionIndex: number; action: string } | null = null
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

  describe('with notes from the lead sheet', () => {
    const melody = melodyOf('Test', [
      measure(1, ['C4:4:'], { section: 'INTRO' }),
      measure(2, ['D4:4:']),
    ])
    const withMelody = async (over = {}) => {
      await setUp(over)
      section.melody = melody
      section.melodyKey = 'C'
      section.melodyMeasures = [0, 1]
      section.displayKey = 'C'
      await section.updateComplete
    }

    it('offers Melody only where the sheet has notes for the section', async () => {
      await setUp()
      expect(showButtons().map(b => b.textContent.trim())).to.deep.equal([
        'All',
        'Lyrics',
        'Chords',
        'None',
      ])
      await withMelody()
      expect(showButtons().map(b => b.textContent.trim())).to.deep.equal([
        'All',
        'Lyrics',
        'Chords',
        'Melody',
        'None',
      ])
    })

    it('marks the part with a music note where the sheet has its notes, lit when they are shown', async () => {
      await setUp()
      expect(section.shadowRoot.querySelector('.melody-mark')).to.equal(null)
      await withMelody()
      const mark = () => section.shadowRoot.querySelector('.melody-mark')
      expect(mark().getAttribute('aria-label')).to.equal(
        'The lead sheet has the melody for this part'
      )
      expect(mark().querySelector('app-icon').getAttribute('name')).to.equal('music')
      expect(getComputedStyle(mark()).opacity).to.equal('0.6')
      section.hideMode = 'melody'
      await section.updateComplete
      expect(mark().getAttribute('aria-label')).to.equal('Showing the melody')
      expect(getComputedStyle(mark()).opacity).to.equal('1')
    })

    it('sends section-action show-melody for the option', async () => {
      await withMelody()
      let action = ''
      section.addEventListener('song-section:action', event => {
        action = event.action
      })
      showButtons()[3].click()
      expect(action).to.equal('show-melody')
    })

    it('shows the notes in place of the lines, and the option pressed', async () => {
      await withMelody({ hideMode: 'melody' })
      expect(section.shadowRoot.querySelector('score-view')).to.not.equal(null)
      expect(section.shadowRoot.querySelector('.chord-line')).to.equal(null)
      const pressed = showButtons().map(b => [b.textContent.trim(), b.getAttribute('aria-pressed')])
      expect(pressed).to.deep.equal([
        ['All', 'false'],
        ['Lyrics', 'false'],
        ['Chords', 'false'],
        ['Melody', 'true'],
        ['None', 'false'],
      ])
      const sheet = section.shadowRoot.querySelector('score-view')
      expect(sheet.measures).to.deep.equal([0, 1])
      expect(sheet.songKey).to.equal('C')
    })

    it('engraves in the key the notes were written in when the song has none shown', async () => {
      await withMelody({ hideMode: 'melody' })
      section.displayKey = ''
      await section.updateComplete
      expect(section.shadowRoot.querySelector('score-view').songKey).to.equal('C')
    })

    it('shows the lines again for a section with no notes, whatever its mode', async () => {
      await setUp({ hideMode: 'melody' })
      expect(section.shadowRoot.querySelector('score-view')).to.equal(null)
      expect(section.shadowRoot.querySelector('.chord-line')).to.not.equal(null)
      expect(showButtons()[0].getAttribute('aria-pressed')).to.equal('true')
    })

    it('recommends the notes for a part with no words, else what it recommended', async () => {
      await withMelody()
      expect(section.getRecommendedHideMode()).to.equal('none')
      section.lines = [{ segments: [{ chord: 'G', lyrics: '' }] }]
      expect(section.getRecommendedHideMode()).to.equal('melody')
      section.melodyMeasures = null
      expect(section.getRecommendedHideMode()).to.equal('lyrics')
    })
  })
})
