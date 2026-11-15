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

/** The extension of a chord (the 7 of "Am7") is this much of the size of the chord, and this much of it above the line */
const SUPERSCRIPT_SIZE = 0.7
const SUPERSCRIPT_RISE = 0.3

/**
 * One run of a chord symbol's text set as a Real Book sets it: the root and a minor sign on the line, the
 * extension ("7", "ø7", "sus4", "maj7#11") smaller and raised, and a bass note ("/E") back on the line.
 * `open` is the run's own tspan, which keeps the root and the minor sign (and the position it was given).
 * A run that is only a flat or a sharp, or only a root, is as it was.
 */
function realBookRun(size: number, rest: string, text: string): string {
  if (/^[A-G]?[b#♭♯♮]?$/.test(text)) return `<tspan font-size="${size}px"${rest}>${text}</tspan>`
  const root = /^[A-G]/.test(text) ? text.slice(0, 1) : ''
  // (matches any text: every part is optional)
  const [, minor = '', extension = '', bass = ''] = /^(-?)([^/]*)(\/.*)?$/.exec(
    realBookQuality(text.slice(root.length))
  ) as RegExpExecArray
  const rise = Math.round(size * SUPERSCRIPT_RISE)
  const up = extension
    ? `<tspan font-size="${Math.round(size * SUPERSCRIPT_SIZE)}px" dy="${-rise}">${extension}</tspan>`
    : ''
  const down = bass
    ? `<tspan font-size="${size}px"${extension ? ` dy="${rise}"` : ''}>${bass}</tspan>`
    : ''
  const line = `${root}${minor}`
  // (a run that starts with the extension leaves nothing on the line: the position it was given is kept)
  const base = line || rest ? `<tspan font-size="${size}px"${rest}>${line}</tspan>` : ''
  return `${base}${up}${down}`
}

/**
 * The chord symbols of the pages in the notation of a Real Book (`realBookQuality`, and the extension
 * raised, `realBookRun`). Only the text of a chord symbol (`g.harm`) is changed. With `on` false the page
 * is as it was.
 */
export function withRealBookChords(svg: string, on = true): string {
  if (!on) return svg
  return svg.replace(/(class="harm"[\s\S]*?<\/g>)/g, harm =>
    harm.replace(
      /<tspan font-size="(\d+)px"([^>]*)>([^<]*)<\/tspan>/g,
      (_all, size: string, rest: string, text: string) => realBookRun(Number(size), rest, text)
    )
  )
}
