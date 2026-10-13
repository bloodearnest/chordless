import { css, html, LitElement } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import { bookmarkletUrl } from '../js/songselect-bookmarklet.ts'

/**
 * BookmarkletInstaller Component
 *
 * The SongSelect bookmarklet, ready to install: a link to drag to the bookmarks
 * bar, and the code with a Copy button for pasting into a new bookmark's URL
 * (for browsers where dragging doesn't work, e.g. on tablets). The bookmarklet
 * imports into the Chordless it was installed from.
 *
 * Usage:
 *   <bookmarklet-installer></bookmarklet-installer>
 */
export class BookmarkletInstaller extends LitElement {
  static override properties = {
    _copyState: { state: true }, // null | 'copied' | 'failed'
  }

  declare _copyState: 'copied' | 'failed' | null

  _code: Ref<HTMLTextAreaElement>
  _url: string

  static override styles = css`
    :host {
      display: block;
    }

    .link {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      cursor: move;
    }

    .link:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
    }

    .hint {
      color: var(--text-secondary, #5f6b6d);
    }

    textarea {
      display: block;
      box-sizing: border-box;
      width: 100%;
      height: 150px;
      font-family: monospace;
      font-size: 12px;
      padding: 10px;
      border: 2px solid #667eea;
      border-radius: 4px;
      margin: 10px 0;
      background: var(--bg-secondary, #f8f9fa);
      color: var(--text-color);
      word-break: break-all;
    }

    .copy-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .copy {
      background: #1e7e34;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 600;
      font-size: inherit;
    }

    .copy:hover {
      background: #19692c;
    }
  `

  constructor() {
    super()
    this._code = createRef()
    this._copyState = null
    this._url = bookmarkletUrl(window.location.origin)
  }

  /** On this page the bookmarklet would only complain it isn't on SongSelect */
  _onLinkClick(event: Event): void {
    event.preventDefault()
  }

  async _copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this._url)
      this._copyState = 'copied'
    } catch (error) {
      console.warn('[Bookmarklet] Could not copy:', error)
      this._code.value?.select()
      this._copyState = 'failed'
    }
  }

  override render() {
    return html`
      <p>
        <a class="link" href=${this._url} @click=${this._onLinkClick} title="Drag me to your bookmarks bar"
          >🎵 Import to Chordless</a
        >
      </p>
      <slot></slot>
      <textarea ${ref(this._code)} readonly aria-label="Bookmarklet code" .value=${this._url}></textarea>
      <div class="copy-row">
        <button class="copy" @click=${this._copy}>📋 Copy Code</button>
        <span class="hint" role="status">
          ${
            this._copyState === 'copied'
              ? "✅ Copied. Paste it as the new bookmark's URL."
              : this._copyState === 'failed'
                ? 'Copying was blocked: the code is selected, copy it from there.'
                : ''
          }
        </span>
      </div>
    `
  }
}

customElements.define('bookmarklet-installer', BookmarkletInstaller)

declare global {
  interface HTMLElementTagNameMap {
    'bookmarklet-installer': BookmarkletInstaller
  }
}
