import { css, html, LitElement, nothing, type PropertyValues } from 'lit'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import type { Score } from '../js/score.ts'
import { writeMusicXml } from '../js/score-musicxml.ts'
import { layoutNotice } from '../js/score-notice.ts'
import { renderScore } from '../js/score-render.ts'
import { transposeScore } from '../js/score-transpose.ts'

/**
 * A song's melody engraved as sheet music (docs/MELODY.md, "Uses"): the lead sheet in the key the
 * song is shown in, as wide as its space with no margin to speak of, and the notice under it.
 *
 * The notes are moved to `songKey` (from `melodyKey`, the key they are written in) by
 * `transposeScore`, whose chord symbols are the app's own, then written as MusicXML and engraved
 * by Verovio in a worker (`score-render.ts`). A new key shows the sheet it had until the new one
 * is ready, so changing key never blanks the page.
 *
 * @property {Score|null} melody - The melody, in `melodyKey`
 * @property {string} melodyKey - The key the melody is written in
 * @property {string} songKey - The key to show it in
 *
 * Events: `score-view:error` when the sheet could not be engraved
 */
export class ScoreViewErrorEvent extends Event {
  static readonly type = 'score-view:error'
  constructor() {
    super(ScoreViewErrorEvent.type, { bubbles: true, composed: true })
  }
}

/** A phone is narrow, so its page is narrower too: the same music, drawn larger once fitted to the width */
const WIDE_PAGE = 2100
const NARROW_PAGE = 1200
const NARROW_BELOW = 600

export class ScoreView extends LitElement {
  static override properties = {
    melody: { attribute: false },
    melodyKey: { type: String, attribute: 'melody-key' },
    songKey: { type: String, attribute: 'song-key' },
    _pages: { state: true },
    _failed: { state: true },
  }

  declare melody: Score | null
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
      background: var(--sheet-background, var(--bg-color, white));
      color: var(--sheet-text, var(--text-color, black));
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
    /* (the music is drawn in the page's text colour, so a dark theme gets light notes on a dark page:
       Verovio's own color="black" on the <svg> is a presentation attribute, which a rule overrides) */
    .page svg {
      color: inherit;
      fill: currentColor;
      display: block;
      width: 100%;
      height: auto;
    }
    /* The words around the music, laid out as CCLI's sheet has them: credits at the top right, the
       terms centred and small at the foot */
    .credits {
      padding: 0.5rem 0.75rem 0;
      font-family: Times, 'Times New Roman', serif;
      color: var(--sheet-notice, var(--text-secondary, #444));
    }
    .subtitle {
      text-align: center;
      font-size: 0.8rem;
      font-style: italic;
    }
    .credit {
      text-align: right;
      margin-top: 0.15rem;
    }
    .credit .label {
      display: block;
      font-size: 0.7rem;
      font-style: italic;
    }
    .credit .names {
      display: block;
      font-size: 0.9rem;
      font-weight: bold;
      color: var(--sheet-text, var(--text-color, inherit));
    }
    .notice {
      padding: 0.5rem 0.75rem 1rem;
      font-family: Times, 'Times New Roman', serif;
      font-size: 0.7rem;
      line-height: 1.25;
      text-align: center;
      color: var(--sheet-notice, var(--text-secondary, #444));
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
          ? transposeScore(melody, this.melodyKey, this.songKey)
          : melody
      const narrow = this.clientWidth > 0 && this.clientWidth < NARROW_BELOW
      const result = await renderScore(writeMusicXml(moved), {
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
      console.error('[ScoreView] Could not engrave the melody:', error)
      this._failed = true
      this.dispatchEvent(new ScoreViewErrorEvent())
    }
  }

  override render() {
    if (this._failed && !this._pages.length) {
      return html`<p class="failed" role="alert">The lead sheet could not be shown for this song.</p>`
    }
    const sections = (this.melody?.measures ?? []).flatMap(m => (m.section ? [m.section] : []))
    const { subtitle, credits, footer } = layoutNotice(
      this.melody?.notice ?? [],
      this.melody?.title ?? null,
      sections
    )
    const shown = this._pages.length > 0
    return html`
      ${
        shown && (subtitle || credits.length)
          ? html`<div class="credits">
            ${subtitle ? html`<div class="subtitle">${subtitle}</div>` : nothing}
            ${credits.map(
              c => html`<div class="credit">
                ${c.label ? html`<span class="label">${c.label}</span>` : nothing}
                <span class="names">${c.names.join(', ')}</span>
              </div>`
            )}
          </div>`
          : nothing
      }
      ${this._pages.map(page => html`<div class="page">${unsafeSVG(page)}</div>`)}
      ${
        shown && footer.length
          ? html`<div class="notice">${footer.map(line => html`<p>${line}</p>`)}</div>`
          : nothing
      }
    `
  }
}
customElements.define('score-view', ScoreView)

declare global {
  interface HTMLElementTagNameMap {
    'score-view': ScoreView
  }
}
