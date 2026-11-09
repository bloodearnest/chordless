/** The notice of a lead sheet, laid out as CCLI's is (src/js/score-notice.ts) */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { layoutNotice } from '../src/js/score-notice.ts'

const adonai = [
  'Adonai',
  '(based on the recording by Gas Street Music)',
  'Words and Music by',
  'Jonny Bird, Josh Grimmet, Nick Herbert and Zo Ross-Waddell',
  'INTRO',
  'CCLI Song # 7253744',
  '© Capitol CMG Genesis | Safe and Sound Music',
  'For use solely with the SongSelect® Terms of Use. All rights reserved. www.ccli.com',
  'CCLI License # 471102',
]

describe('layoutNotice', () => {
  it('sorts a CCLI notice into subtitle, credits and footer, dropping the title and a section name', () => {
    assert.deepEqual(layoutNotice(adonai, 'Adonai', ['Intro', 'Verse']), {
      subtitle: '(based on the recording by Gas Street Music)',
      credits: [
        {
          label: 'Words and Music by',
          names: ['Jonny Bird, Josh Grimmet, Nick Herbert and Zo Ross-Waddell'],
        },
      ],
      footer: adonai.slice(5),
    })
  })

  it('keeps separate credits apart, and names with no label', () => {
    const out = layoutNotice(['Words by', 'A', 'Music by', 'B', 'C', 'CCLI Song # 1'], null)
    assert.deepEqual(out.credits, [
      { label: 'Words by', names: ['A'] },
      { label: 'Music by', names: ['B'] },
      { label: '', names: ['C'] },
    ])
  })

  it('puts everything in the footer when there is no CCLI song number to divide at', () => {
    const out = layoutNotice(['Some terms', '', 'More terms'], null)
    assert.deepEqual(out, { subtitle: null, credits: [], footer: ['Some terms', 'More terms'] })
  })
})
