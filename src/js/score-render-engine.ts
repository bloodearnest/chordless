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
}

export interface RenderedScore {
  /** One SVG document a page */
  pages: string[]
  /** What the toolkit said about the file: warnings of anything it could not read */
  log: string
}

/** The MusicXML as SVG pages, or null if Verovio could not read it */
export async function renderScoreHere(
  musicXml: string,
  options: RenderOptions = {}
): Promise<RenderedScore | null> {
  const tk = await load()
  tk.setOptions({
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
    footer: 'none',
    header: 'none',
    svgViewBox: true,
    svgRemoveXlink: true,
  })
  if (!tk.loadData(musicXml)) return null
  const pages: string[] = []
  // (the page's policy allows no <style> element, so the few rules Verovio puts in each page are the
  // view's own: `score-view.ts`)
  for (let page = 1; page <= tk.getPageCount(); page++) {
    pages.push(withoutStyle(tk.renderToSVG(page)))
  }
  return { pages, log: tk.getLog() }
}
