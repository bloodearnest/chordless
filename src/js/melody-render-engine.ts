/**
 * Engraves a melody as sheet music, with Verovio: the renderer SongSelect itself uses for its lead
 * sheets (docs/MELODY.md), so a sheet made here looks like theirs. It takes the MusicXML that
 * `writeMusicXml` makes and gives SVG, one string a page.
 *
 * This is the engine, which runs wherever it is called. The app does not call it on the page: the
 * page's Content-Security-Policy has no `'wasm-unsafe-eval'`, which Verovio's WebAssembly needs. It
 * runs in a worker (`verovio-worker.ts`) whose own policy allows that and nothing else, and the page
 * asks it through `renderMelody` (`melody-render.ts`). Node, for the tests and the scripts, calls
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

export interface RenderOptions {
  /** The width of a page, in the toolkit's units (a tenth of a millimetre at scale 100); 2100 is A4 */
  pageWidth?: number
  /** Percent: 100 is the size SongSelect prints at the width above */
  scale?: number
}

export interface RenderedMelody {
  /** One SVG document a page */
  pages: string[]
  /** What the toolkit said about the file: warnings of anything it could not read */
  log: string
}

/** The MusicXML as SVG pages, or null if Verovio could not read it */
export async function renderMelodyHere(
  musicXml: string,
  options: RenderOptions = {}
): Promise<RenderedMelody | null> {
  const tk = await load()
  tk.setOptions({
    pageWidth: options.pageWidth ?? 2100,
    scale: options.scale ?? 40,
    // the page is as tall as the music, so a view scrolls it and no page ends mid-song
    adjustPageHeight: true,
    // (a section box is centred on its barline, so the first one needs room to its left)
    pageMarginLeft: 120,
    footer: 'none',
    header: 'none',
    svgViewBox: true,
    svgRemoveXlink: true,
  })
  if (!tk.loadData(musicXml)) return null
  const pages: string[] = []
  for (let page = 1; page <= tk.getPageCount(); page++) pages.push(tk.renderToSVG(page))
  return { pages, log: tk.getLog() }
}
