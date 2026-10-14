import { css, html, LitElement } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import {
  getCapoPreference,
  getMusicianType,
  markSetupDone,
  setCapoPreference,
  setMusicianType,
} from '../js/preferences.ts'
import './app-modal.ts'
import type { AppModal } from './app-modal.ts'
import { buttonStyles } from './shared-styles.ts'

/**
 * FirstUseSetup
 *
 * The one-time question of how the user reads a song: chords and lyrics, or lyrics only, and
 * whether to show a capo control. It is shown on the first visit to any page (so also to someone
 * who arrives by a share link), and never again once closed, however it is closed.
 *
 * The choices are the ones in Preferences, saved as soon as they are made.
 */
export class FirstUseSetup extends LitElement {
  static override properties = {
    _lyricsOnly: { state: true },
    _capo: { state: true },
  }

  declare _lyricsOnly: boolean
  declare _capo: boolean

  #modal = createRef<AppModal>()

  constructor() {
    super()
    const musicianType = getMusicianType()
    this._lyricsOnly = musicianType === 'singer' || musicianType === 'drummer'
    this._capo = getCapoPreference()
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

  _chooseDisplay(lyricsOnly: boolean): void {
    this._lyricsOnly = lyricsOnly
    setMusicianType(lyricsOnly ? 'singer' : 'general')
  }

  _chooseCapo(event: Event): void {
    this._capo = (event.currentTarget as HTMLInputElement).checked
    setCapoPreference(this._capo)
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
          <legend>What do you read?</legend>
          <label class="choice">
            <input
              type="radio"
              name="display"
              .checked=${!this._lyricsOnly}
              @change=${() => this._chooseDisplay(false)}
            />
            <span>Chords and lyrics: I play an instrument</span>
          </label>
          <label class="choice">
            <input
              type="radio"
              name="display"
              .checked=${this._lyricsOnly}
              @change=${() => this._chooseDisplay(true)}
            />
            <span>Lyrics only: I sing, or don't need chords</span>
          </label>
        </fieldset>
        <label class="choice">
          <input type="checkbox" .checked=${this._capo} @change=${this._chooseCapo} />
          <span>I play guitar: show a capo control</span>
        </label>
        <p>You can change these later in Preferences.</p>
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
