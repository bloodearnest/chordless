import { css, html, LitElement } from 'lit'
import { ref } from 'lit/directives/ref.js'
import type { AnnotationKind } from '../js/annotations/store.ts'
import { DialogPopup } from '../js/dialog-popup.ts'
import { frameBounds } from '../js/utils/frame.ts'
import { buttonStyles, fieldStyles } from './shared-styles.ts'

/** What the annotation editor is asked to edit */
export interface AnnotationEditorRequest {
  /** What it opens beside */
  anchorElement: HTMLElement
  /** What the annotation is on: “grace”, or “Chorus” */
  about: string
  text: string
  kind: AnnotationKind
  /** The user can share a annotation with the team (else "The team" is off, with the reason) */
  canShare: boolean
  /** A annotation that is not made yet: there is nothing to delete */
  isNew: boolean
}

/** What was chosen: kept as this (a annotation with no text is deleted), or deleted; null if closed without either */
export type AnnotationEditorResult =
  | { action: 'save'; text: string; kind: AnnotationKind }
  | { action: 'delete' }
  | null

/**
 * The editor for a annotation (docs/ANNOTATIONS.md): its words, where it is shown (this setlist, or this song
 * wherever it is) and who sees it (just me, or the team). A popup in a modal <dialog> beside what
 * was pressed; on a narrow screen it sits at the top, clear of the on-screen keyboard.
 *
 *   const result = await editor.edit({ anchorElement, about: '“grace”', … })
 */
export class AnnotationEditor extends LitElement {
  static override properties = {
    _request: { state: true },
    _text: { state: true },
    _scope: { state: true },
    _reach: { state: true },
  }

  declare _request: AnnotationEditorRequest | null
  declare _text: string
  declare _scope: AnnotationKind['scope']
  declare _reach: AnnotationKind['reach']

  #popup = new DialogPopup(this, { position: dialog => this.#place(dialog) })
  #settle: ((result: AnnotationEditorResult) => void) | null = null
  #answer: AnnotationEditorResult = null

  static override styles = [
    buttonStyles,
    fieldStyles,
    css`
      :host {
        display: contents;
      }

      dialog {
        position: fixed;
        inset: unset;
        top: -9999px;
        left: -9999px;
        margin: 0;
        padding: 1rem;
        width: min(22rem, calc(100vw - 1rem));
        box-sizing: border-box;
        background: var(--modal-bg, white);
        color: var(--text-color, #1a1a1a);
        border: 1px solid var(--modal-border, transparent);
        border-radius: 8px;
        box-shadow: var(--modal-shadow, 0 4px 20px rgba(0, 0, 0, 0.3));
        font-size: var(--font-ui);
      }

      dialog::backdrop {
        background: rgba(0, 0, 0, 0.25);
      }

      h2 {
        margin: 0 0 0.5rem;
        font-size: var(--font-ui);
        font-weight: 600;
      }

      textarea {
        line-height: 1.3;
        resize: vertical;
        min-height: 4.5em;
      }

      fieldset {
        border: none;
        padding: 0;
        margin: 0.75rem 0 0;
      }

      legend {
        padding: 0;
        font-size: var(--font-ui-small);
        opacity: 0.75;
      }

      .choices {
        display: flex;
        gap: 0.25rem;
        margin-top: 0.25rem;
      }

      .choices label {
        flex: 1;
        text-align: center;
        padding: 0.5rem 0.4rem;
        border: 1px solid var(--border-color, #d5dbdb);
        border-radius: 6px;
        cursor: pointer;
        font-size: var(--font-ui-small);
      }

      .choices label:has(input:checked) {
        background: var(--button-bg, #2477ad);
        border-color: var(--button-bg, #2477ad);
        color: var(--button-text, white);
      }

      .choices label:has(input:disabled) {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .choices label:has(input:focus-visible) {
        outline: 2px solid var(--focus-ring, #3498db);
        outline-offset: 2px;
      }

      .choices input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }

      .hint {
        margin: 0.35rem 0 0;
        font-size: var(--font-ui-small);
        opacity: 0.75;
      }

      .actions {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
        margin-top: 1rem;
      }

      .actions .delete {
        margin-right: auto;
      }
    `,
  ]

  constructor() {
    super()
    this._request = null
    this._text = ''
    this._scope = 'setlist'
    this._reach = 'private'
  }

  /** Open it; resolves when it is closed */
  edit(request: AnnotationEditorRequest): Promise<AnnotationEditorResult> {
    this.#settle?.(null)
    this._request = request
    this._text = request.text
    this._scope = request.kind.scope
    this._reach = request.kind.reach
    this.#answer = null
    return new Promise(resolve => {
      this.#settle = resolve
      void this.updateComplete.then(() => {
        this.#popup.show()
        this.renderRoot.querySelector('textarea')?.focus()
      })
    })
  }

  /** Beside what was pressed (below it, or above if there is no room); at the top on a narrow screen */
  #place(dialog: HTMLDialogElement) {
    const frame = frameBounds()
    const width = dialog.offsetWidth
    const target = this._request?.anchorElement.getBoundingClientRect()
    const narrow = window.innerWidth < 640
    if (!target || narrow) {
      dialog.style.top = '3rem'
      dialog.style.left = `${Math.max(frame.left + 8, (frame.left + frame.right - width) / 2)}px`
      return
    }
    const below = target.bottom + 6
    const room = window.innerHeight - below
    dialog.style.top = `${room >= dialog.offsetHeight ? below : Math.max(8, target.top - dialog.offsetHeight - 6)}px`
    dialog.style.left = `${Math.max(frame.left + 8, Math.min(target.left, frame.right - width - 8))}px`
  }

  #finish(result: AnnotationEditorResult) {
    this.#answer = result
    this.#popup.close()
  }

  #closed = () => {
    this.#popup.onClose()
    // (a request that came in just after one was closed has reopened it: this is the old one's event)
    if (this.#popup.isOpen) return
    const settle = this.#settle
    this.#settle = null
    settle?.(this.#answer)
  }

  #save() {
    this.#finish({
      action: 'save',
      text: this._text.trim(),
      kind: { scope: this._scope, reach: this._reach },
    })
  }

  /** Shared annotations are for this setlist: the team's copy is the setlist's */
  #canChoose(reach: AnnotationKind['reach']): boolean {
    return reach === 'private' || (Boolean(this._request?.canShare) && this._scope === 'setlist')
  }

  #choose(field: '_scope' | '_reach', value: string) {
    if (field === '_scope') {
      this._scope = value as AnnotationKind['scope']
      // (what is only for the setlist's own cannot be kept for the song)
      if (this._scope === 'song') this._reach = 'private'
    } else {
      this._reach = value as AnnotationKind['reach']
    }
  }

  override render() {
    const request = this._request
    if (!request) return html``
    const sharingWhy = !request.canShare
      ? 'Only people who can edit the setlist can share a annotation.'
      : this._scope === 'song'
        ? 'A annotation kept for the song is only yours; annotations shared with the team belong to a setlist.'
        : ''
    return html`
      <dialog
        ${ref(this.#popup.ref)}
        aria-label="Annotation"
        @click=${this.#popup.onClick}
        @close=${this.#closed}
      >
        <h2>${request.isNew ? 'New annotation' : 'Annotation'} on ${request.about}</h2>
        <textarea
          class="field"
          rows="3"
          maxlength="280"
          aria-label="Annotation text"
          placeholder="e.g. quietly, drop out, repeat 4×"
          .value=${this._text}
          @input=${(event: Event) => {
            this._text = (event.target as HTMLTextAreaElement).value
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) this.#save()
          }}
        ></textarea>
        <fieldset>
          <legend>Shown in</legend>
          <div class="choices">
            ${this.#radio('scope', '_scope', 'setlist', 'This setlist', this._scope)}
            ${this.#radio('scope', '_scope', 'song', 'Always, this song', this._scope)}
          </div>
        </fieldset>
        <fieldset>
          <legend>Seen by</legend>
          <div class="choices">
            ${this.#radio('reach', '_reach', 'private', 'Just me', this._reach)}
            ${this.#radio('reach', '_reach', 'shared', 'The team', this._reach, !this.#canChoose('shared'))}
          </div>
          ${sharingWhy ? html`<p class="hint">${sharingWhy}</p>` : ''}
        </fieldset>
        <div class="actions">
          ${
            request.isNew
              ? ''
              : html`<button class="btn danger delete" @click=${() => this.#finish({ action: 'delete' })}>
                  Delete
                </button>`
          }
          <button class="btn" @click=${() => this.#finish(null)}>Cancel</button>
          <button class="btn primary" @click=${() => this.#save()}>Done</button>
        </div>
      </dialog>
    `
  }

  #radio(
    name: string,
    field: '_scope' | '_reach',
    value: string,
    label: string,
    current: string,
    disabled = false
  ) {
    return html`<label>
      <input
        type="radio"
        name=${name}
        .value=${value}
        .checked=${current === value}
        ?disabled=${disabled}
        @change=${() => this.#choose(field, value)}
      />
      ${label}
    </label>`
  }
}

customElements.define('annotation-editor', AnnotationEditor)

declare global {
  interface HTMLElementTagNameMap {
    'annotation-editor': AnnotationEditor
  }
}
