/**
 * The words around a lead sheet that have to travel with it (docs/LEAD_SHEETS.md, "The terms"), laid out as
 * CCLI lays them out: under the title a small italic subtitle, "Words and Music by" and the writers at
 * the right, and at the foot, centred and small, the CCLI song number, the copyright, the terms and
 * the licence. A score keeps these as a plain list of lines, the sheet's own text in reading order, so
 * what is a credit and what is a footer is worked out here from what the lines say.
 */

export interface ScoreNoticeLayout {
  /** "(based on the recording by ...)", under the title */
  subtitle: string | null
  /** "Words and Music by" and the names after it; the label is empty for names with none */
  credits: { label: string; names: string[] }[]
  /** The lines at the foot: from "CCLI Song #" on */
  footer: string[]
}

const CREDIT_LABEL =
  /^(?:(?:words|music|lyrics|arranged|arrangement|translated|based)\b.*\bby|by):?$/i
const SONG_NUMBER = /^CCLI Song #/i

/**
 * The lines of a sheet's notice sorted into the places CCLI puts them. Lines that are not notice:
 * the title (the page has it in its header) and a section's name that the reader of a sheet picked up
 * with the text of the page (`sections`, in any case).
 */
export function layoutNotice(
  lines: string[],
  title: string | null,
  sections: string[] = []
): ScoreNoticeLayout {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  const kept = lines.filter(
    line => line.trim() && !(title && same(line, title)) && !sections.some(s => same(line, s))
  )
  const at = kept.findIndex(line => SONG_NUMBER.test(line.trim()))
  const head = at < 0 ? [] : kept.slice(0, at)
  const footer = at < 0 ? kept : kept.slice(at)
  const layout: ScoreNoticeLayout = { subtitle: null, credits: [], footer }
  for (const line of head) {
    const text = line.trim()
    if (/^\(.*\)$/.test(text) && layout.subtitle === null) layout.subtitle = text
    else if (CREDIT_LABEL.test(text)) layout.credits.push({ label: text, names: [] })
    else {
      const last = layout.credits[layout.credits.length - 1]
      if (last && !last.names.length) last.names.push(text)
      else layout.credits.push({ label: '', names: [text] })
    }
  }
  return layout
}
