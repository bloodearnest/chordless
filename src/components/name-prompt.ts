import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import { saveAccountName } from '../js/account-info.ts'
import { t } from '../js/text.ts'
import { errorMessage } from '../js/utils/errors.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'
import { buttonStyles, fieldStyles } from './shared-styles.ts'

/**
 * The question "What should we call you?" (docs/ACCOUNT.md, "The account"), asked once after signing in when the account has no
 * name. It is a modal over whatever page they are on, answered or left with "Not now", and goes when it is.
 */
export class NamePrompt extends LitElement {
  static override properties = {
    suggested: { type: String },
    _error: { state: true },
    _busy: { state: true },
  }

  /** What their sign-in said their name was, to start from */
  declare suggested: string
  declare _error: string
  declare _busy: boolean

  _modal: Ref<AppModal> = createRef()

  static override styles = [
    buttonStyles,
    fieldStyles,
    css`
      form { display: flex; flex-direction: column; gap: 0.75rem; }
      .error { color: var(--color-danger, #e74c3c); margin: 0; }
      .actions { display: flex; gap: 0.75rem; flex-wrap: wrap; }
    `,
  ]

  constructor() {
    super()
    this.suggested = ''
    this._error = ''
    this._busy = false
  }

  override firstUpdated(): void {
    this._modal.value?.show()
  }

  /** Close the question, and go */
  _leave = (event: Event): void => {
    if (event.target === this._modal.value) this.remove()
  }

  async _save(event: Event): Promise<void> {
    event.preventDefault()
    const input = (event.target as HTMLFormElement).elements.namedItem('name') as HTMLInputElement
    this._busy = true
    this._error = ''
    try {
      await saveAccountName(input.value)
      this.remove()
    } catch (error) {
      this._error = errorMessage(error)
    } finally {
      this._busy = false
    }
  }

  override render() {
    return html`
      <app-modal
        ${ref(this._modal)}
        size="small"
        heading=${t('name-prompt-heading')}
        @app-modal:close=${this._leave}
      >
        <form @submit=${this._save}>
          <p>${t('name-prompt-text')}</p>
          <input
            class="field"
            name="name"
            autocomplete="name"
            maxlength="100"
            required
            aria-label=${t('account-name-label')}
            .value=${this.suggested}
          />
          ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
          <div class="actions">
            <button class="btn primary" type="submit" ?disabled=${this._busy}>${t('action-save')}</button>
            <button class="btn" type="button" @click=${() => this._modal.value?.close()}>${t('name-prompt-later')}</button>
          </div>
        </form>
      </app-modal>
    `
  }
}
customElements.define('name-prompt', NamePrompt)

declare global {
  interface HTMLElementTagNameMap {
    'name-prompt': NamePrompt
  }
}
