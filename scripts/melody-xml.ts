/**
 * Reading the SVG of a `GetSongLeadPreview` response: the oracle the PDF reader is developed against
 * (docs/MELODY.md). Nothing in `src/` uses it: the app reads the PDF alone.
 */
import type { Melody } from '../src/js/melody.ts'
import { type ReadStats, readMelodyTrees } from '../src/js/melody-read.ts'
import { parseXml } from '../src/js/xml.ts'

/** Read the pages' SVG text, in page order, into a melody */
export function readMelodySvg(svgs: string[], stats?: ReadStats): Melody {
  return readMelodyTrees(
    svgs.flatMap(svg => parseXml(svg) ?? []),
    stats
  )
}
