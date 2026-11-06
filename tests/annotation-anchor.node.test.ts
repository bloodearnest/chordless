/**
 * Where annotations sit on a chart and finding the place again (src/js/annotations/anchor.ts). A
 * chart is fixed in place and the fix arrives by sync, so an annotation finds its place from what it
 * keeps and the chart as it is, and is healed (its anchor rebuilt) so a run of edits does not lose it.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  healedAnchor,
  placeAnnotations,
  resolveAnchor,
  sectionAnchor,
  similarity,
  snapOffset,
  textAnchor,
} from '../src/js/annotations/anchor.ts'
import { healSources } from '../src/js/annotations/heal.ts'
import { noSources } from '../src/js/annotations/store.ts'
import type { AnnotationAnchor, ChartAnnotation, ChartSection } from '../src/js/data-types.ts'

/** A section of lines, each a list of lyric pieces (a chord over each) */
const section = (label: string | null, ...lines: (string | string[])[]): ChartSection => ({
  type: 'section',
  label,
  lines: lines.map(line => ({
    segments: (typeof line === 'string' ? [line] : line).map((lyrics, i) => ({
      chord: i ? 'G' : 'C',
      lyrics,
    })),
  })),
})

const chart = [
  section('Verse', ['Amazing ', 'grace how sweet'], 'the sound that saved'),
  section('Chorus', 'My chains are gone'),
  section('Verse', 'Twas grace that taught'),
]

/** Where an anchor is placed, without how sure that is */
const placed = (sections: ChartSection[], anchor: AnnotationAnchor) => {
  const { sure: _sure, ...placement } = resolveAnchor(sections, anchor)
  return placement
}
const sure = (sections: ChartSection[], anchor: AnnotationAnchor) =>
  resolveAnchor(sections, anchor).sure

const annotation = (id: string, anchor: AnnotationAnchor): ChartAnnotation => ({
  id,
  anchor,
  body: { kind: 'text', text: id },
  modified: '',
})

test('a spot is remembered by its lyrics, not by its chords, with a snapshot of its line', () => {
  const anchor = textAnchor(chart, 0, 0, 8)
  assert.deepEqual(anchor, {
    kind: 'text',
    label: 'Verse',
    nth: 0,
    line: 0,
    offset: 8,
    before: 'Amazing ',
    after: 'grace how sw',
    lineText: 'Amazing grace how sweet',
    prevLine: '',
    nextLine: 'the sound that saved',
    occ: 0,
    sectionHead: 'Amazing grace how sweet',
  })
  assert.deepEqual(placed(chart, anchor), { place: 'text', section: 0, line: 0, offset: 8 })
  assert.equal(sure(chart, anchor), true)
})

test('the second section with the same label is found as the second', () => {
  assert.deepEqual(sectionAnchor(chart, 2), {
    kind: 'section',
    label: 'Verse',
    nth: 1,
    sectionHead: 'Twas grace that taught',
  })
  assert.deepEqual(placed(chart, sectionAnchor(chart, 2)), { place: 'section', section: 2 })
})

test('a song annotation is the song', () => {
  assert.deepEqual(placed(chart, { kind: 'song' }), { place: 'song' })
})

test('an unchanged chart leaves nothing to heal', () => {
  const found = placeAnnotations(chart, [
    annotation('a', textAnchor(chart, 0, 1, 4)),
    annotation('b', sectionAnchor(chart, 1)),
  ])
  assert.deepEqual(
    found.map(each => each.healed),
    [undefined, undefined]
  )
})

test('lines added above, or taken away above, move the annotation with its line', () => {
  const anchor = textAnchor(chart, 0, 1, 4)
  const added = [
    section(
      'Verse',
      'A new first line',
      'and another',
      ['Amazing ', 'grace how sweet'],
      'the sound that saved'
    ),
    ...chart.slice(1),
  ]
  assert.deepEqual(placed(added, anchor), { place: 'text', section: 0, line: 3, offset: 4 })
  const gone = [section('Verse', 'the sound that saved'), ...chart.slice(1)]
  assert.deepEqual(placed(gone, anchor), { place: 'text', section: 0, line: 0, offset: 4 })
})

test('a line reworded: a word changed, added or taken away, the annotation stays on it, at the same word', () => {
  const anchor = textAnchor(chart, 0, 0, 14) // on "how"
  for (const line of [
    'Amazing grace how sour',
    'Amazing grace, oh how sweet',
    'Amazing grace how',
  ]) {
    const edited = [section('Verse', line, 'the sound that saved'), ...chart.slice(1)]
    const found = placed(edited, anchor)
    assert.equal(found.place, 'text', line)
    assert.equal((found as { line: number }).line, 0, line)
    const offset = (found as { offset: number }).offset
    assert.equal(line.slice(offset, offset + 3), line.includes('oh how') ? 'how' : 'how', line)
  }
})

test('the word at the spot reworded: it stays on the line, at the word that is now there', () => {
  const anchor = textAnchor(chart, 0, 0, 8) // "grace"
  const edited = [
    section('Verse', 'Amazing mercy how sweet', 'the sound that saved'),
    ...chart.slice(1),
  ]
  const found = placed(edited, anchor) as { line: number; offset: number }
  assert.equal(found.line, 0)
  assert.equal('Amazing mercy how sweet'.slice(found.offset, found.offset + 5), 'mercy')
})

test('a line split in two, or two joined, keeps the annotation on the part or whole that is most like it', () => {
  const anchor = textAnchor(chart, 0, 1, 4)
  const joined = [
    section('Verse', ['Amazing grace how sweet the sound that saved']),
    ...chart.slice(1),
  ]
  assert.equal((placed(joined, anchor) as { line: number }).line, 0)
  const split = [
    section('Verse', 'Amazing grace how sweet', 'the sound', 'that saved'),
    ...chart.slice(1),
  ]
  const found = placed(split, anchor)
  assert.equal(found.place, 'text')
})

test('a section renamed, renumbered or moved: found by its lines', () => {
  const anchor = textAnchor(chart, 1, 0, 3)
  const renamed = [
    chart[0] as ChartSection,
    section('Refrain', 'My chains are gone'),
    chart[2] as ChartSection,
  ]
  assert.deepEqual(placed(renamed, anchor), { place: 'text', section: 1, line: 0, offset: 3 })
  const moved = [chart[1] as ChartSection, chart[0] as ChartSection, chart[2] as ChartSection]
  assert.deepEqual(placed(moved, anchor), { place: 'text', section: 0, line: 0, offset: 3 })
  assert.deepEqual(placed(renamed, sectionAnchor(chart, 1)), { place: 'section', section: 1 })
  assert.equal(sure(renamed, sectionAnchor(chart, 1)), true)
})

test('a line that is said again is told apart by the lines beside it', () => {
  const song = [
    section(
      'Chorus',
      'Holy holy holy',
      'Lord God almighty',
      'Holy holy holy',
      'Early in the morning',
      'Holy holy holy',
      'Merciful and mighty'
    ),
  ]
  const second = textAnchor(song, 0, 2, 0)
  // a line is added above: the second "Holy holy holy" is now the fourth line
  const edited = [
    section(
      'Chorus',
      'Sing it out',
      'Holy holy holy',
      'Lord God almighty',
      'Holy holy holy',
      'Early in the morning',
      'Holy holy holy',
      'Merciful and mighty'
    ),
  ]
  assert.deepEqual(placed(edited, second), { place: 'text', section: 0, line: 3, offset: 0 })
})

test('identical lines with identical neighbours are told apart by which of them it was', () => {
  const song = [section('Tag', 'Amen', 'Amen', 'Amen', 'Amen')]
  const third = textAnchor(song, 0, 2, 0)
  const edited = [section('Tag', 'Go on', 'Amen', 'Amen', 'Amen', 'Amen')]
  assert.deepEqual(placed(edited, third), { place: 'text', section: 0, line: 3, offset: 0 })
})

test('a line that is gone falls back to its section, not for sure, and is found again if it comes back', () => {
  const anchor = textAnchor(chart, 1, 0, 3)
  const rewritten = [
    chart[0] as ChartSection,
    section('Chorus', 'Something else entirely'),
    chart[2] as ChartSection,
  ]
  assert.deepEqual(placed(rewritten, anchor), { place: 'section', section: 1 })
  assert.equal(sure(rewritten, anchor), false)
  // (nothing is rebuilt from a guess, so what is kept still finds the line when it is restored)
  assert.equal(placeAnnotations(rewritten, [annotation('a', anchor)])[0]?.healed, undefined)
  assert.deepEqual(placed(chart, anchor), { place: 'text', section: 1, line: 0, offset: 3 })
})

test('an annotation whose section and lines are both gone is orphaned, not dropped', () => {
  const only = [chart[0] as ChartSection]
  assert.deepEqual(placed(only, textAnchor(chart, 1, 0, 3)), { place: 'orphan' })
  assert.deepEqual(placed(only, sectionAnchor(chart, 1)), { place: 'orphan' })
  assert.equal(sure(only, sectionAnchor(chart, 1)), false)
})

test('a title whose section was one of several with its name, and one went, is on the nearest', () => {
  const anchor = sectionAnchor(chart, 2) // the second Verse
  const one = [chart[0] as ChartSection, chart[1] as ChartSection]
  assert.deepEqual(placed(one, { ...anchor, sectionHead: 'something else' } as AnnotationAnchor), {
    place: 'section',
    section: 0,
  })
})

test('an annotation made before snapshots is found by the text around it, and healed to have one', () => {
  const full = textAnchor(chart, 0, 0, 8) as Extract<AnnotationAnchor, { kind: 'text' }>
  const { lineText: _l, prevLine: _p, nextLine: _n, occ: _o, sectionHead: _s, ...old } = full
  assert.deepEqual(placed(chart, old), { place: 'text', section: 0, line: 0, offset: 8 })
  const added = [
    section('Verse', 'A first line', ['Amazing ', 'grace how sweet'], 'the sound that saved'),
    ...chart.slice(1),
  ]
  assert.deepEqual(placed(added, old), { place: 'text', section: 0, line: 1, offset: 8 })
  const [found] = placeAnnotations(added, [annotation('a', old)])
  assert.deepEqual(found?.healed, textAnchor(added, 0, 1, 8))
  // and a legacy anchor that does not hold anywhere is the section, not for sure
  assert.deepEqual(placed([section('Verse', 'nothing alike')], old), {
    place: 'section',
    section: 0,
  })
})

test('healing rebuilds the anchor where it moved, and not where it did not', () => {
  const anchor = textAnchor(chart, 0, 1, 4)
  const added = [
    section('Verse', 'A new first line', ['Amazing ', 'grace how sweet'], 'the sound that saved'),
    ...chart.slice(1),
  ]
  const resolved = resolveAnchor(added, anchor)
  assert.deepEqual(healedAnchor(added, anchor, resolved), textAnchor(added, 0, 2, 4))
  assert.equal(healedAnchor(chart, anchor, resolveAnchor(chart, anchor)), undefined)
  assert.equal(
    healedAnchor(chart, { kind: 'song' }, resolveAnchor(chart, { kind: 'song' })),
    undefined
  )
  assert.equal(healedAnchor(chart, anchor, { place: 'orphan', sure: false }), undefined)
})

test('healSources rebuilds only the kinds it is asked to, and says nothing when nothing moved', () => {
  const anchor = textAnchor(chart, 0, 1, 4)
  const added = [
    section('Verse', 'A new first line', ['Amazing ', 'grace how sweet'], 'the sound that saved'),
    ...chart.slice(1),
  ]
  const sources = { shared: [annotation('s', anchor) as never], private: [annotation('p', anchor)] }
  const privateOnly = healSources(added, sources, ['private'])
  assert.equal(privateOnly?.shared, sources.shared)
  assert.equal(((privateOnly?.private[0]?.anchor ?? {}) as { line?: number }).line, 2)
  const both = healSources(added, sources, ['private', 'shared'])
  assert.equal(((both?.shared[0]?.anchor ?? {}) as { line?: number }).line, 2)
  assert.equal(healSources(chart, sources, ['private', 'shared']), null)
  assert.equal(healSources(added, noSources(), ['private']), null)
})

test('a run of small edits is followed when each is kept, and loses it when the first anchor is all there is', () => {
  const edits: string[][] = [
    ['A new line', 'Amazing grace how sweet', 'the sound that saved'],
    ['A new line', 'Amazing grace how sweet', 'the sound that saved a wretch'],
    ['A new line', 'Amazing grace, how sweet', 'that saved a wretch'],
    ['A new line', 'Amazing grace, how sweet it is', 'that saved a wretch'],
    ['A new line', 'Such amazing grace, how sweet it is', 'that saved a wretch like me'],
    ['A new line', 'Such an amazing grace, how sweet it is to hear', 'that saved a wretch like me'],
  ]
  const original = [section('Verse', 'Amazing grace how sweet', 'the sound that saved')]
  const first = textAnchor(original, 0, 1, 4)
  let kept = first
  const unkept = first
  let healedAll = true
  let unkeptFound = true
  for (const lines of edits) {
    const sections = [section('Verse', ...lines)]
    const resolved = resolveAnchor(sections, kept)
    const there =
      resolved.place === 'text' &&
      resolved.sure &&
      /^(the sound|that saved)/.test(lines[resolved.line] ?? '')
    if (!there) healedAll = false
    const next = healedAnchor(sections, kept, resolved)
    if (next) kept = next
    const stale = resolveAnchor(sections, unkept)
    if (
      !(
        stale.place === 'text' &&
        stale.sure &&
        /(the sound|that saved)/.test(lines[stale.line] ?? '')
      )
    )
      unkeptFound = false
  }
  assert.equal(healedAll, true, 'following each edit with healing')
  assert.equal(unkeptFound, false, 'without healing it is lost along the way')
})

test('similarity is 1 for the same words, whatever the case and marks, and falls as more differs', () => {
  assert.equal(similarity('Amazing Grace!', 'amazing  grace'), 1)
  assert.equal(similarity('Maj - es - ty', 'maj es ty'), 1)
  assert.equal(similarity('', ''), 1)
  assert.equal(similarity('hello', ''), 0)
  assert.ok(similarity('Amazing grace how sweet', 'Amazing grace how sour') > 0.8)
  assert.ok(similarity('Amazing grace how sweet', 'something else entirely') < 0.4)
})

test('an approximate spot snaps to the nearest start of a word or segment', () => {
  const verse = chart[0] as ChartSection
  // "Amazing " | "grace how sweet": words start at 0, 8, 14, 18; the segment at 8
  assert.equal(snapOffset(verse, 0, 0), 0)
  assert.equal(snapOffset(verse, 0, 7), 8)
  assert.equal(snapOffset(verse, 0, 10), 8)
  assert.equal(snapOffset(verse, 0, 16), 14)
  assert.equal(snapOffset(verse, 0, 99), 18)
  assert.equal(snapOffset(verse, 5, 3), 0)
  assert.equal(snapOffset(section('Hy', ['Maj - ', 'es - ', 'ty']), 0, 7), 6)
})

test('every annotation is placed, in the order given', () => {
  const found = placeAnnotations(chart, [
    annotation('a', sectionAnchor(chart, 1)),
    annotation('b', { kind: 'song' }),
  ])
  assert.deepEqual(
    found.map(({ annotation: each, placement }) => [each.id, placement.place]),
    [
      ['a', 'section'],
      ['b', 'song'],
    ]
  )
})

test('an offset past the end is clamped, and a blank line still holds its annotation', () => {
  const blank = [section('Intro', '')]
  const anchor = textAnchor(blank, 0, 0, 40)
  assert.equal(anchor.kind === 'text' && anchor.offset, 0)
  assert.deepEqual(placed(blank, anchor), { place: 'text', section: 0, line: 0, offset: 0 })
})

test('an annotation kept with a line but no neighbours (from a share) is found by the line alone', () => {
  const anchor: AnnotationAnchor = {
    kind: 'text',
    label: 'Chorus',
    nth: 0,
    line: 0,
    offset: 3,
    before: 'My ',
    after: 'chains are g',
    lineText: 'My chains are gone',
  }
  const moved = [chart[0] as ChartSection, section('Chorus', 'Hey', 'My chains are gone')]
  assert.deepEqual(placed(moved, anchor), { place: 'text', section: 1, line: 1, offset: 3 })
})

test('a spot at a word the line now has twice is at the one nearest where it was', () => {
  const anchor = textAnchor([section('V', 'we sing and we sing')], 0, 0, 12) // the second "we"
  const edited = [section('V', 'we cry and we sing')]
  const found = placed(edited, anchor) as { offset: number }
  assert.equal(found.offset, 11)
  assert.equal('we cry and we sing'.slice(found.offset, found.offset + 7), 'we sing')
})

test('and at the first of them when that is the one it was at', () => {
  const anchor = textAnchor([section('V', 'we sing and we sing')], 0, 0, 0)
  const found = placed([section('V', 'we cry and we sing')], anchor) as { offset: number }
  assert.equal(found.offset, 0)
})

test('a line that was a space and is now empty has no word to be at: the start', () => {
  const anchor = textAnchor([section('V', ' ', 'Hello there')], 0, 0, 0)
  const edited = [section('V', '', 'Hello there')]
  assert.deepEqual(placed(edited, anchor), { place: 'text', section: 0, line: 0, offset: 0 })
})

test('a line moved into another section is found there, though its old section is still named', () => {
  const anchor = textAnchor(chart, 1, 0, 3)
  const edited = [
    section('Verse', 'My chains are gone', 'the sound that saved'),
    section('Chorus', 'Something else entirely'),
  ]
  assert.deepEqual(placed(edited, anchor), { place: 'text', section: 0, line: 0, offset: 3 })
})

test('a legacy annotation in the second of several sections is looked for there first', () => {
  const full = textAnchor(chart, 1, 0, 3) as Extract<AnnotationAnchor, { kind: 'text' }>
  const { lineText: _l, prevLine: _p, nextLine: _n, occ: _o, sectionHead: _s, ...old } = full
  const edited = [
    chart[0] as ChartSection,
    section('Chorus', 'Oh', 'My chains are gone'),
    chart[2] as ChartSection,
  ]
  assert.deepEqual(placed(edited, old), { place: 'text', section: 1, line: 1, offset: 3 })
})

test('a title for the fifth of a name there are two of, whose first line is gone, is on the nearest', () => {
  const found = placed(chart, { kind: 'section', label: 'Verse', nth: 5, sectionHead: 'zzz qqq' })
  assert.deepEqual(found, { place: 'section', section: 2 })
})

test('healing keeps the annotations that did not move as they are', () => {
  const anchor = textAnchor(chart, 0, 1, 4)
  const still = textAnchor(chart, 1, 0, 0)
  const added = [
    section('Verse', 'A new first line', ['Amazing ', 'grace how sweet'], 'the sound that saved'),
    ...chart.slice(1),
  ]
  const sources = { shared: [], private: [annotation('moved', anchor), annotation('still', still)] }
  const healed = healSources(added, sources, ['private'])
  assert.equal(healed?.private[1], sources.private[1])
  assert.notEqual(healed?.private[0], sources.private[0])
})
