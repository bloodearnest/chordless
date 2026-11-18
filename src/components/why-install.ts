import { css, html, LitElement, nothing } from 'lit'
import { createRef, type Ref, ref } from 'lit/directives/ref.js'
import { currentInstallMode } from '../js/install.ts'
import { rich } from '../js/rich-text.ts'
import { t } from '../js/text.ts'
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
        ${t('why-install-link')}
      </button>
      <app-modal ${ref(this._modal)} size="medium" heading=${t('why-install-heading')}>
        <div class="why">
          <ul>
            <li>
              ${rich('why-install-stay', undefined, { strong: words => html`<strong>${words}</strong>` })}
            </li>
            <li>
              ${rich('why-install-screen', undefined, { strong: words => html`<strong>${words}</strong>` })}
            </li>
            <li>
              ${rich('why-install-feel', undefined, { strong: words => html`<strong>${words}</strong>` })}
            </li>
          </ul>
          ${currentInstallMode() === 'ios' ? html`<p>${t('why-install-ios')}</p>` : nothing}
          <p>${t('why-install-not-needed')}</p>
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
