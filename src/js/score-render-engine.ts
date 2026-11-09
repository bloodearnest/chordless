/**
 * Engraves a melody as sheet music, with Verovio: the renderer SongSelect itself uses for its lead
 * sheets (docs/MELODY.md), so a sheet made here looks like theirs. It takes the MusicXML that
 * `writeMusicXml` makes and gives SVG, one string a page.
 *
 * This is the engine, which runs wherever it is called. The app does not call it on the page: the
 * page's Content-Security-Policy has no `'wasm-unsafe-eval'`, which Verovio's WebAssembly needs. It
 * runs in a worker (`verovio-worker.ts`) whose own policy allows that and nothing else, and the page
 * asks it through `renderScore` (`score-render.ts`). Node, for the tests and the scripts, calls
 * this directly.
 *
 * Verovio is a 7 MB module, so it is only imported when a sheet is first rendered, and its toolkit is
 * kept for the next one.
 */

/** What the toolkit of `verovio/esm` has that is used here */
interface Toolkit {
  setOptions(options: Record<string, unknown>): void
  loadData(data: string): boolean
  getPageCount(): number
  renderToSVG(page: number): string
  getLog(): string
  destroy(): void
}

let toolkit: Promise<Toolkit> | null = null

function load(): Promise<Toolkit> {
  toolkit ??= (async () => {
    const [{ default: createModule }, { VerovioToolkit, enableLogToBuffer }] = await Promise.all([
      import('verovio/wasm'),
      import('verovio/esm'),
    ])
    const module = await createModule()
    // (what it says about a file goes to `getLog`, not to the console)
    enableLogToBuffer(1, module)
    return new VerovioToolkit(module) as Toolkit
  })()
  // (a failed load is tried again next time, not kept)
  toolkit.catch(() => {
    toolkit = null
  })
  return toolkit
}

/**
 * The SVG without its <style> elements. Taken out until none is left, so that a pair made by taking
 * one out (`<sty<style></style>le>`) cannot be left behind: Verovio escapes the words of a score, so
 * the only one it writes is its own, but this does not rely on that.
 */
export function withoutStyle(svg: string): string {
  let out = svg
  for (let before = ''; before !== out; ) {
    before = out
    out = out.replace(/<style[\s\S]*?<\/style>/gi, '')
  }
  return out
}

export interface RenderOptions {
  /** The width of a page, in the toolkit's units (a tenth of a millimetre at scale 100); 2100 is A4 */
  pageWidth?: number
  /** Percent: 100 is the size SongSelect prints at the width above */
  scale?: number
  /**
   * The MusicXML of each section on its own (`writeSectionsMusicXml`): given, every section starts a
   * line, as on SongSelect's sheets, and its measures are shared out over its lines (`balanceLines`)
   */
  sections?: string[]
}

export interface RenderedScore {
  /** One SVG document a page */
  pages: string[]
  /** What the toolkit said about the file: warnings of anything it could not read */
  log: string
}

/**
 * The measures on each line, shared out more evenly: a section's last line is not left with one or
 * two measures stretched across the page while the line before it is full. A measure moves down
 * from the line before, which had room for it, until the two differ by one at most.
 */
export function balanceLines(counts: number[]): number[] {
  const out = [...counts]
  for (let i = out.length - 1; i > 0; i--) {
    while ((out[i - 1] as number) - (out[i] as number) > 1) {
      out[i - 1] = (out[i - 1] as number) - 1
      out[i] = (out[i] as number) + 1
    }
  }
  return out
}

/** How many measures are on each line of the pages Verovio laid out */
function measuresPerLine(tk: Toolkit): number[] {
  const out: number[] = []
  for (let page = 1; page <= tk.getPageCount(); page++) {
    for (const line of tk.renderToSVG(page).split('class="system"').slice(1)) {
      out.push(line.split('class="measure"').length - 1)
    }
  }
  return out
}

/**
 * The index of each measure that starts a line, when every section starts one: each section laid
 * out on its own, with the lines Verovio breaks it into, balanced. Null if a section could not be read.
 */
function lineStarts(tk: Toolkit, sections: string[]): Set<number> | null {
  const starts = new Set<number>()
  let at = 0
  for (const section of sections) {
    if (!tk.loadData(section)) return null
    for (const count of balanceLines(measuresPerLine(tk))) {
      starts.add(at)
      at += count
    }
  }
  return starts
}

/** The MusicXML with a new line at each of these measures (by index) */
function withLineBreaks(musicXml: string, starts: Set<number>): string {
  let index = -1
  return musicXml.replace(/<measure\b[^>]*>/g, open => {
    index++
    return index > 0 && starts.has(index) ? `${open}<print new-system="yes"/>` : open
  })
}

/** The MusicXML as SVG pages, or null if Verovio could not read it */
export async function renderScoreHere(
  musicXml: string,
  options: RenderOptions = {}
): Promise<RenderedScore | null> {
  const tk = await load()
  tk.setOptions({
    // (where the lines break: Verovio's choice, unless the sections are given; see below)
    breaks: 'auto',
    pageWidth: options.pageWidth ?? 2100,
    scale: options.scale ?? 40,
    // the page is as tall as the music, so a view scrolls it and no page ends mid-song
    adjustPageHeight: true,
    // (no more margin than the measure numbers need: a section's box starts at its barline, so
    // none hangs off the left, score-musicxml.ts, and the page is fitted to the width of the screen)
    pageMarginLeft: 30,
    pageMarginRight: 20,
    pageMarginTop: 20,
    pageMarginBottom: 20,
    // (a word's width of space between words, not Verovio's 1.2: with that, a line of short words on
    // quick notes ran them together, "richin love", once the narrow margin let another bar onto it)
    lyricWordSpace: 3,
    footer: 'none',
    header: 'none',
    svgViewBox: true,
    svgRemoveXlink: true,
  })
  // Every section starts a line. Verovio's own way to keep a line break that is written in the file
  // while it breaks the rest ('smart') did not keep them, so each section is laid out alone to find its
  // lines, and the whole is laid out with exactly those breaks ('line')
  const sections = options.sections ?? []
  const starts = sections.length > 1 ? lineStarts(tk, sections) : null
  if (starts) tk.setOptions({ breaks: 'line' })
  if (!tk.loadData(starts ? withLineBreaks(musicXml, starts) : musicXml)) return null
  const pages: string[] = []
  // (the page's policy allows no <style> element, so the few rules Verovio puts in each page are the
  // view's own: `score-view.ts`)
  for (let page = 1; page <= tk.getPageCount(); page++) {
    pages.push(withoutStyle(tk.renderToSVG(page)))
  }
  return { pages, log: tk.getLog() }
}
