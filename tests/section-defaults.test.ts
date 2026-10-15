import { expect } from '@open-wc/testing'
import {
  defaultHideMode,
  hideModeForChoice,
  sectionLabel,
} from '../src/js/setlist/section-defaults.ts'

describe('what a part of a song shows by default', () => {
  it('is mapped from every word the preferences use', () => {
    for (const none of ['all', 'show-all', 'default', 'none', '', undefined, 'unknown', 'ALL']) {
      expect(hideModeForChoice(none), String(none)).to.equal('none')
    }
    expect(hideModeForChoice('lyrics')).to.equal('chords')
    expect(hideModeForChoice('chords')).to.equal('lyrics')
    expect(hideModeForChoice('collapse')).to.equal('collapse')
    expect(hideModeForChoice('hide')).to.equal('hide')
    expect(hideModeForChoice('hidden')).to.equal('hide')
  })

  it('names a part by its label, or by nothing', () => {
    expect(sectionLabel(null)).to.equal('')
    expect(sectionLabel({ dataset: { label: ' Chorus ' } })).to.equal('chorus')
    expect(sectionLabel({ label: ' Bridge' })).to.equal('bridge')
    expect(sectionLabel({ dataset: {}, label: '' })).to.equal('')
  })

  it('is the choice for the part, else the choice for every part, else what the part suits', () => {
    const defaults = { all: 'lyrics', chorus: 'hide' }
    expect(defaultHideMode('chorus', 'none', defaults)).to.equal('hide')
    expect(defaultHideMode('verse 1', 'none', defaults)).to.equal('chords')
    expect(defaultHideMode('', 'none', defaults)).to.equal('chords')
    expect(defaultHideMode('verse 1', 'lyrics', {})).to.equal('lyrics')
    expect(defaultHideMode('verse 1', 'lyrics', { all: 'all' })).to.equal('lyrics')
  })

  it('collapses a part that has nothing to show of what was chosen', () => {
    expect(defaultHideMode('', 'lyrics', { all: 'lyrics' })).to.equal('collapse')
    expect(defaultHideMode('', 'chords', { all: 'chords' })).to.equal('collapse')
    expect(defaultHideMode('', 'chords', { all: 'lyrics' })).to.equal('chords')
    expect(defaultHideMode('', 'lyrics', { all: 'chords' })).to.equal('lyrics')
  })
})
