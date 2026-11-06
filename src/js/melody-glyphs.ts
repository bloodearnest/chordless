/**
 * The music font's glyphs as they appear in a lead sheet PDF: drawn shapes with no name. The shape of
 * each (its path, normalised by `absolutePath` and hashed by `shapeHash`) is its SMuFL code. The
 * shapes of the 137 lead sheets in the spike's corpus are these 31; they came from the glyph
 * definitions in a `GetSongLeadPreview` SVG (which names them) and, for the ones that song does not use, from
 * looking at the shape and at where it is drawn. A shape not in the table is an unknown glyph:
 * the reader says so and the measure it is in does not pass.
 *
 * Codes: E0A2 whole head, E0A3 half head, E0A4 filled head, E0A9 x head, E050 G clef, E062 F clef,
 * E07A small G clef, E08x time signature digit x (E08B cut time), E1E7 a dot, E240-E243 flags (8th up,
 * 8th down, 16th up, 16th down), E260 flat, E261 natural, E262 sharp, E4E3-E4E7 rests (whole to 16th),
 * E4C0 and E4C1 fermatas, E887 a tuplet's number.
 */
export const GLYPHS: Record<string, string> = {
  '9dd8a9f6': 'E0A4',
  '17a1b3b8': 'E262',
  '055910bc': 'E4E5',
  'debcb964': 'E4E6',
  '8e28e2fd': 'E050',
  '311fa4c0': 'E240',
  '4c8eff12': 'E260',
  '1a876232': 'E0A3',
  '6ede6377': 'E241',
  '4575508a': 'E1E7',
  '249df975': 'E4E4',
  '6547f3e5': 'E084',
  '57c8d514': 'E0A2',
  'ddd8800c': 'E4E3',
  '56db6b77': 'E4E7',
  'afbc6925': 'E242',
  '4423d783': 'E887',
  '6101c3e8': 'E0A9',
  '0c409bd0': 'E243',
  'b8977175': 'E4C0',
  '546002e1': 'E088',
  '4db1b704': 'E082',
  'f6b981ac': 'E083',
  '80171c06': 'E086',
  '65f69827': 'E261',
  '00de47c0': 'E1E7',
  '2413a6bc': 'E085',
  '1bcabccb': 'E08B',
  'bb360f5c': 'E4C1',
  '87e57072': 'E062',
  '5dfeb1fd': 'E07A',
}
