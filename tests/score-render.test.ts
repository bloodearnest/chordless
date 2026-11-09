import { expect } from '@open-wc/testing'
import { renderScore } from '../src/js/score-render.ts'

const { describe, it } = window

/** One bar of four quarter notes, the shape `writeMusicXml` writes */
const MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
<part id="P1"><measure number="1">
<attributes><divisions>24</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
${['C', 'D', 'E', 'F']
  .map(
    (step, i) =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>24</duration><voice>1</voice><type>quarter</type><lyric number="1"><syllabic>single</syllabic><text>la${i}</text></lyric></note>`
  )
  .join('\n')}
</measure></part></score-partwise>`

describe('engraving a melody in a worker', () => {
  it('gives the SVG of the page, made by Verovio in a worker rather than on the page', async () => {
    const out = await renderScore(MUSIC_XML)
    expect(out).to.not.equal(null)
    expect(out?.pages).to.have.length(1)
    const svg = out?.pages[0] as string
    expect(svg.startsWith('<svg')).to.equal(true)
    expect(svg.match(/class="notehead"/g)).to.have.length(4)
    expect(svg.match(/class="syl"/g)).to.have.length(4)
  })

  it('answers the next sheet from the same worker, and null for what is not music', async () => {
    const [again, nothing] = await Promise.all([renderScore(MUSIC_XML), renderScore('not music')])
    expect(again?.pages).to.have.length(1)
    expect(nothing).to.equal(null)
  })
})
