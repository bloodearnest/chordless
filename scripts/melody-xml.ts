/**
 * Reading the SVG of a `GetSongLeadPreview` response: the oracle the PDF reader is developed against
 * (docs/LEAD_SHEETS.md). Nothing in `src/` uses it: the app reads the PDF alone.
 */
import type { Score } from '../src/js/score.ts'
import { type ReadStats, readScoreTrees } from '../src/js/score-read.ts'
import { parseXml } from '../src/js/xml.ts'

/** Read the pages' SVG text, in page order, into a melody */
export function readScoreSvg(svgs: string[], stats?: ReadStats): Score {
  return readScoreTrees(
    svgs.flatMap(svg => parseXml(svg) ?? []),
    stats
  )
}
