/** The accidentals of a chord symbol, which Verovio sets in its own music font (a private-use character of it) */
const CHORD_ACCIDENTALS: Record<string, string> = { '\uEA64': '♭', '\uEA65': '♮', '\uEA63': '♯' }

/**
 * The flats and sharps of chord symbols as ordinary text characters. Verovio writes them as one
 * character of "Leipzig", a font the page does not have, so they would be blank, and the symbol would
 * read "B m7" with a gap where the flat should be (and run into the next).
 */
export function withTextAccidentals(svg: string): string {
  return svg.replace(
    /(?:<tspan font-size="(\d+)px"[^>]*>[^<]*<\/tspan>\s*)?<tspan font-family="Leipzig"[^>]*>([\uEA63-\uEA65])<\/tspan>/g,
    (all, size: string | undefined, glyph: string) => {
      const before = all.slice(0, all.indexOf('<tspan font-family="Leipzig"'))
      // (the text it sits in is 0px: the size is the letter's before it, which it is set at)
      return `${before}<tspan font-size="${size ?? 405}px">${CHORD_ACCIDENTALS[glyph]}</tspan>`
    }
  )
}
