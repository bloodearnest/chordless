import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import { currentInstallMode } from '../js/install.ts'
import type { AppModal } from './app-modal.ts'
import './app-modal.ts'

/**
 * WhyInstall
 *
 * A "Why install?" button that opens a popup with what installing Chordless gives you. Wherever
 * the app suggests installing, so the reason is one tap away and says the same thing each time.
 *
 * Only what installing really changes is listed: the offline use, the update checks and the
 * screen-awake setting work in a browser tab too.
 */
export class WhyInstall extends LitElement {
  _modal: Ref<AppModal> = createRef()

  static override styles = css`
    :host {
      display: inline;
    }

    /* A button that reads as a link */
    .link {
      background: none;
      border: none;
      padding: 0;
      font: inherit;
      /* The primary colour, a little toward the text colour: it clears 4.5:1 on a panel in both
         themes (the primary alone is just under it in the light one) */
      color: color-mix(in srgb, var(--color-primary, #2477ad) 85%, var(--text-color, #1a1a1a));
      text-decoration: underline;
      cursor: pointer;
    }

    .link:focus-visible {
      outline: 2px solid var(--focus-ring, #3498db);
      outline-offset: 2px;
    }

    .why {
      padding: 0 1.5rem 1.5rem;
      color: var(--text-color, #1a1a1a);
      font-size: var(--font-ui-small);
      line-height: 1.5;
    }

    ul {
      margin: 0;
      padding-left: 1.25rem;
      display: grid;
      gap: 0.75rem;
    }

    p {
      margin: 1rem 0 0;
      opacity: 0.75;
    }
  `

  override render() {
    return html`
      <button class="link" type="button" @click=${() => this._modal.value?.show()}>
        Why install?
      </button>
      <app-modal ${ref(this._modal)} size="medium" heading="Why install Chordless?">
        <div class="why">
          <ul>
            <li>
              <strong>Your songs stay put.</strong> A browser can clear the saved data of a website
              it thinks is unused (Safari does after about a week). An installed app is protected
              from that, so your songs and setlists are still there on the day.
            </li>
            <li>
              <strong>The whole screen for the song.</strong> No address bar or tabs getting in the
              way.
            </li>
            <li>
              <strong>Feels like any other app you use.</strong> It has its own icon, opens in its
              own window, and shows up in your app switcher.
            </li>
          </ul>
          ${
            currentInstallMode() === 'ios'
              ? html`<p>
                On an iPhone or iPad the installed app keeps its own data, separate from Safari's,
                so you sign in again in it.
              </p>`
              : nothing
          }
          <p>
            Chordless works offline, checks for updates and can keep the screen awake in a browser
            tab too. Installing isn't needed for those.
          </p>
        </div>
      </app-modal>
    `
  }
}

customElements.define('why-install', WhyInstall)

declare global {
  interface HTMLElementTagNameMap {
    'why-install': WhyInstall
  }
}
