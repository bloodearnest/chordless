import { css, html, LitElement } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import {
  getMusicianType,
  type MusicianType,
  markSetupDone,
  setMusicianType,
} from '../js/preferences.ts'
import { PLAYS } from '../js/what-do-you-play.ts'
import './app-modal.ts'
import type { AppModal } from './app-modal.ts'
import { buttonStyles } from './shared-styles.ts'

/** The choices at first use: the types, and not Custom, which is for Preferences */
const FIRST_USE_PLAYS = PLAYS.filter(option => option.type !== 'custom')

/**
 * FirstUseSetup
 *
 * The one-time question, "What do you play?", which sets what a song shows to start with and which
 * controls there are (docs/PERSONAL_LAYER.md, "How I play it"). It is shown on the first visit to any
 * page (so also to someone who arrives by a share link), and never again once closed, however it is
 * closed.
 *
 * The choice is the one in Preferences (where each setting can also be set by itself), saved as soon
 * as it is made.
 */
export class FirstUseSetup extends LitElement {
  static override properties = {
    _type: { state: true },
  }

  declare _type: MusicianType

  #modal = createRef<AppModal>()

  constructor() {
    super()
    this._type = getMusicianType()
  }

  static override styles = [
    buttonStyles,
    css`
      p {
        font-size: var(--font-ui-small);
        line-height: 1.5;
        margin: 0 0 0.75rem;
      }

      fieldset {
        border: none;
        margin: 0 0 0.75rem;
        padding: 0;
      }

      legend {
        font-size: var(--font-ui-small);
        font-weight: 600;
        padding: 0;
        margin: 0 0 0.25rem;
      }

      /* The whole row is the tap target */
      .choice {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0;
        font-size: var(--font-ui-small);
        cursor: pointer;
      }

      .text {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }

      .name {
        font-weight: 600;
      }

      .description {
        opacity: 0.8;
      }

      .choice input {
        width: 1.5rem;
        height: 1.5rem;
        flex-shrink: 0;
        margin: 0;
        cursor: pointer;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
    `,
  ]

  override firstUpdated() {
    this.#modal.value?.show()
  }

  _choose(type: MusicianType): void {
    setMusicianType(type)
    this._type = getMusicianType()
  }

  /** Closed by a button, Esc or a click outside: all mean the question is done with */
  _closed(): void {
    markSetupDone()
    this.remove()
  }

  override render() {
    return html`
      <app-modal
        heading="Welcome to Chordless"
        size="medium"
        hide-close-button
        ${ref(this.#modal)}
        @app-modal:close=${this._closed}
      >
        <p>
          Chordless is an application for managing and using setlists for bands. A few quick
          questions to set up some defaults for you:
        </p>
        <fieldset>
          <legend>What do you play?</legend>
          ${FIRST_USE_PLAYS.map(
            option => html`
              <label class="choice">
                <input
                  type="radio"
                  name="plays"
                  .checked=${this._type === option.type}
                  @change=${() => this._choose(option.type)}
                />
                <span class="text">
                  <span class="name">${option.label}</span>
                  <span class="description">${option.description}</span>
                </span>
              </label>
            `
          )}
        </fieldset>
        <p>You can change this later in Preferences, where each setting can be set by itself.</p>
        <div class="actions" slot="actions">
          <button class="btn" @click=${() => this.#modal.value?.close()}>Skip</button>
          <button class="btn primary" @click=${() => this.#modal.value?.close()}>Continue</button>
        </div>
      </app-modal>
    `
  }
}
customElements.define('first-use-setup', FirstUseSetup)

declare global {
  interface HTMLElementTagNameMap {
    'first-use-setup': FirstUseSetup
  }
}
