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
  /** The user can share an annotation with everyone (else "Everyone" is off, with the reason) */
  canShare: boolean
  /** An annotation that is not made yet: there is nothing to delete */
  isNew: boolean
}

/** What was chosen: kept as this (an annotation with no text is deleted), or deleted; null if closed without either */
export type AnnotationEditorResult =
  | { action: 'save'; text: string; kind: AnnotationKind }
  | { action: 'delete' }
  | null

/**
 * The editor for an annotation (docs/ANNOTATIONS.md): its words, and who sees it (just me, or
 * everyone who has the setlist). A popup in a modal <dialog> beside what was pressed; on a narrow
 * screen it sits at the top, clear of the on-screen keyboard.
 *
 *   const result = await editor.edit({ anchorElement, about: '“grace”', … })
 */
export class AnnotationEditor extends LitElement {
  static override properties = {
    _request: { state: true },
    _text: { state: true },
    _kind: { state: true },
  }

  declare _request: AnnotationEditorRequest | null
  declare _text: string
  declare _kind: AnnotationKind

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
    this._kind = 'private'
  }

  /** Open it; resolves when it is closed */
  edit(request: AnnotationEditorRequest): Promise<AnnotationEditorResult> {
    this.#settle?.(null)
    this._request = request
    this._text = request.text
    this._kind = request.kind
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
      kind: this._kind,
    })
  }

  override render() {
    const request = this._request
    if (!request) return html``
    const hint = !request.canShare
      ? 'Only people who can edit the setlist can share an annotation with everyone.'
      : this._kind === 'shared'
        ? 'Everyone who has this setlist sees it.'
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
          <legend>Seen by</legend>
          <div class="choices">
            ${this.#radio('private', 'Just me')}
            ${this.#radio('shared', 'Everyone', !request.canShare)}
          </div>
          ${hint ? html`<p class="hint">${hint}</p>` : ''}
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

  #radio(kind: AnnotationKind, label: string, disabled = false) {
    return html`<label>
      <input
        type="radio"
        name="seen-by"
        .value=${kind}
        .checked=${this._kind === kind}
        ?disabled=${disabled}
        @change=${() => {
          this._kind = kind
        }}
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
