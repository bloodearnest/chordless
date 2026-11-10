/** The accidentals of a chord symbol, which Verovio sets in its own music font (a private-use character of it) */
const CHORD_ACCIDENTALS: Record<string, string> = { '\uEA64': '♭', '\uEA65': '♮', '\uEA63': '♯' }
/** The same as the letters of a chart ("Bbm7"), which sit close to the letter before them, as the ♭ of a text font does not */
const CHORD_LETTERS: Record<string, string> = { '\uEA64': 'b', '\uEA65': '♮', '\uEA63': '#' }

/**
 * The flats and sharps of chord symbols as ordinary text characters. Verovio writes them as one
 * character of "Leipzig", a font the page does not have, so they would be blank, and the symbol would
 * read "B m7" with a gap where the flat should be (and run into the next). They are the letters "b" and
 * "#" of the chart's own chords, which sit close to the root; with `unicode` (the preference for ♯ and ♭)
 * the signs, which a text font gives a wide space of their own.
 */
export function withTextAccidentals(svg: string, unicode = false): string {
  return svg.replace(
    /(?:<tspan font-size="(\d+)px"[^>]*>[^<]*<\/tspan>\s*)?<tspan font-family="Leipzig"[^>]*>([\uEA63-\uEA65])<\/tspan>/g,
    (all, size: string | undefined, glyph: string) => {
      const before = all.slice(0, all.indexOf('<tspan font-family="Leipzig"'))
      // (the text it sits in is 0px: the size is the letter's before it, which it is set at)
      return `${before}<tspan font-size="${size ?? 405}px">${(unicode ? CHORD_ACCIDENTALS : CHORD_LETTERS)[glyph]}</tspan>`
    }
  )
}
