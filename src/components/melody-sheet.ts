import { css, html, LitElement, nothing, type PropertyValues } from 'lit'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import type { Melody } from '../js/melody.ts'
import { writeMusicXml } from '../js/melody-musicxml.ts'
import { renderMelody } from '../js/melody-render.ts'
import { transposeMelody } from '../js/melody-transpose.ts'

/**
 * A song's melody engraved as sheet music (docs/MELODY.md, "Uses"): the lead sheet in the key the
 * song is shown in, as wide as its space with no margin to speak of, and the notice under it.
 *
 * The notes are moved to `songKey` (from `melodyKey`, the key they are written in) by
 * `transposeMelody`, whose chord symbols are the app's own, then written as MusicXML and engraved
 * by Verovio in a worker (`melody-render.ts`). A new key shows the sheet it had until the new one
 * is ready, so changing key never blanks the page.
 *
 * @property {Melody|null} melody - The melody, in `melodyKey`
 * @property {string} melodyKey - The key the melody is written in
 * @property {string} songKey - The key to show it in
 *
 * Events: `melody-sheet:error` when the sheet could not be engraved
 */
export class MelodySheetErrorEvent extends Event {
  static readonly type = 'melody-sheet:error'
  constructor() {
    super(MelodySheetErrorEvent.type, { bubbles: true, composed: true })
  }
}

/** A phone is narrow, so its page is narrower too: the same music, drawn larger once fitted to the width */
const WIDE_PAGE = 2100
const NARROW_PAGE = 1200
const NARROW_BELOW = 600

export class MelodySheet extends LitElement {
  static override properties = {
    melody: { attribute: false },
    melodyKey: { type: String, attribute: 'melody-key' },
    songKey: { type: String, attribute: 'song-key' },
    _pages: { state: true },
    _failed: { state: true },
  }

  declare melody: Melody | null
  declare melodyKey: string
  declare songKey: string
  declare _pages: string[]
  declare _failed: boolean
  /** The newest engraving asked for: an older one that finishes later is dropped */
  _asked = 0

  static override styles = css`
    :host {
      display: block;
      /* (the player's controls float over the bottom of the page: the last line can be scrolled clear of them) */
      padding-bottom: 6rem;
      background: var(--sheet-background, white);
      color: var(--sheet-text, black);
    }
    :host([hidden]) {
      display: none;
    }
    /* what Verovio's own <style> says, which the page's policy would not allow in the SVG */
    .page g.ending,
    .page g.fing,
    .page g.reh,
    .page g.tempo {
      font-weight: bold;
    }
    .page g.dir,
    .page g.dynam,
    .page g.mNum {
      font-style: italic;
    }
    .page g.label {
      font-weight: normal;
    }
    .page ellipse,
    .page path,
    .page polygon,
    .page polyline,
    .page rect {
      stroke: currentColor;
    }
    .page svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .notice {
      padding: 0.5rem 0.75rem 1rem;
      font-size: 0.75rem;
      line-height: 1.4;
      color: var(--sheet-notice, #444);
    }
    .notice p {
      margin: 0;
    }
    .failed {
      padding: 1rem;
    }
  `

  constructor() {
    super()
    this.melody = null
    this.melodyKey = ''
    this.songKey = ''
    this._pages = []
    this._failed = false
  }

  override willUpdate(changed: PropertyValues): void {
    if (changed.has('melody') || changed.has('melodyKey') || changed.has('songKey')) {
      void this._engrave()
    }
  }

  async _engrave(): Promise<void> {
    const melody = this.melody
    if (!melody) {
      this._pages = []
      return
    }
    const asked = ++this._asked
    try {
      // (a key that is not known leaves the notes as they were written)
      const moved =
        this.melodyKey && this.songKey
          ? transposeMelody(melody, this.melodyKey, this.songKey)
          : melody
      const narrow = this.clientWidth > 0 && this.clientWidth < NARROW_BELOW
      const result = await renderMelody(writeMusicXml(moved), {
        pageWidth: narrow ? NARROW_PAGE : WIDE_PAGE,
      })
      if (asked !== this._asked) return
      /* v8 ignore next -- Verovio only gives null for MusicXML it cannot read, which writeMusicXml does not write */
      if (!result) throw new Error('The lead sheet could not be read')
      this._pages = result.pages
      this._failed = false
    } catch (error) {
      /* v8 ignore next -- an older engraving that fails after a newer one was asked for */
      if (asked !== this._asked) return
      console.error('[MelodySheet] Could not engrave the melody:', error)
      this._failed = true
      this.dispatchEvent(new MelodySheetErrorEvent())
    }
  }

  override render() {
    if (this._failed && !this._pages.length) {
      return html`<p class="failed" role="alert">The lead sheet could not be shown for this song.</p>`
    }
    const notice = this.melody?.notice ?? []
    return html`
      ${this._pages.map(page => html`<div class="page">${unsafeSVG(page)}</div>`)}
      ${
        this._pages.length && notice.length
          ? html`<div class="notice">${notice.map(line => html`<p>${line}</p>`)}</div>`
          : nothing
      }
    `
  }
}
customElements.define('melody-sheet', MelodySheet)

declare global {
  interface HTMLElementTagNameMap {
    'melody-sheet': MelodySheet
  }
}
