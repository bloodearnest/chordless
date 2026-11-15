/** The accidentals of a chord symbol, which Verovio sets in its own music font (a private-use character of it) */
const CHORD_ACCIDENTALS: Record<string, string> = {
  '\uEA64': '♭',
  '\uEA65': '♮',
  '\uEA63': '♯',
  '\uEA66': '♯',
}
/** The same as the letters of a chart ("Bbm7"), which sit close to the letter before them, as the ♭ of a text font does not */
const CHORD_LETTERS: Record<string, string> = {
  '\uEA64': 'b',
  '\uEA65': '♮',
  '\uEA63': '#',
  '\uEA66': '#',
}

/**
 * The flats and sharps of chord symbols as ordinary text characters. Verovio writes them as one
 * character of "Leipzig", a font the page does not have, so they would be blank, and the symbol would
 * read "B m7" with a gap where the flat should be (and run into the next). They are the letters "b" and
 * "#" of the chart's own chords, which sit close to the root; with `unicode` (the preference for ♯ and ♭)
 * the signs, which a text font gives a wide space of their own.
 */
export function withTextAccidentals(svg: string, unicode = false): string {
  return svg.replace(
    /(?:<tspan font-size="(\d+)px"[^>]*>[^<]*<\/tspan>\s*)?<tspan font-family="(?:Leipzig|Petaluma)"[^>]*>([\uEA63-\uEA66])<\/tspan>/g,
    (all, size: string | undefined, glyph: string) => {
      const before = all.slice(0, all.search(/<tspan font-family="(?:Leipzig|Petaluma)"/))
      // (the text it sits in is 0px: the size is the letter's before it, which it is set at)
      return `${before}<tspan font-size="${size ?? 405}px">${(unicode ? CHORD_ACCIDENTALS : CHORD_LETTERS)[glyph]}</tspan>`
    }
  )
}

/**
 * The quality of a chord ("m7", "m7b5") as a Real Book writes it, for the symbols that nearly every chart
 * agrees on: a minus for minor, a circle for diminished, a slashed circle for half-diminished, a plus for
 * augmented. The ones that vary from chart to chart are left as the chart has them: the major seventh
 * (`Δ7`, `M7` or `maj7`) and an explicit major triad (`maj`, `M`). So are the words that follow the
 * quality ("sus4", "add9", a bass).
 */
export function realBookQuality(quality: string): string {
  return quality
    .replace(/^m7b5/, 'ø7')
    .replace(/^dim/, '°')
    .replace(/^aug/, '+')
    .replace(/^(?:min|m)(?!aj)/, '-')
}

/** Chord symbols are drawn this much bigger in the Real Book style, where they are bigger than the words under the music */
const REAL_BOOK_CHORD_SCALE = 1.15

/**
 * The chord symbols of the pages in the notation of a Real Book (`realBookQuality`), and a little bigger
 * (`REAL_BOOK_CHORD_SCALE`). Only the text of a chord symbol (`g.harm`) is changed: the root is the first
 * letter of the first run, and a run after a flat or sharp is all quality. With `on` false the page is as
 * it was.
 */
export function withRealBookChords(svg: string, on = true): string {
  if (!on) return svg
  return svg.replace(/(class="harm"[\s\S]*?<\/g>)/g, harm =>
    harm.replace(
      /<tspan font-size="(\d+)px"([^>]*)>([^<]*)<\/tspan>/g,
      (_all, size: string, rest: string, text: string) => {
        const root = /^[A-G]/.test(text) && !/^[A-G]$/.test(text) ? text.slice(0, 1) : ''
        const bigger = Math.round(Number(size) * REAL_BOOK_CHORD_SCALE)
        return `<tspan font-size="${bigger}px"${rest}>${root}${realBookQuality(text.slice(root.length))}</tspan>`
      }
    )
  )
}
