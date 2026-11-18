import { css, html, LitElement } from 'lit'
import { rich } from '../js/rich-text.ts'
import { t } from '../js/text.ts'
import './bookmarklet-installer.ts'

/**
 * SongSelectHelp Component
 *
 * How to install the bookmarklet that imports a song from CCLI SongSelect, and
 * how it works. Shown on the Import Songs page.
 *
 * Usage:
 *   <songselect-help></songselect-help>
 */
export class SongSelectHelp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      color: var(--text-color);
    }

    h3 {
      font-size: 1.6rem;
      margin: 3rem 0 1rem;
    }

    section:first-of-type h3 {
      margin-top: 0;
    }

    h4 {
      font-size: 1.4rem;
      margin: 2rem 0 1rem;
    }

    .note {
      color: var(--text-secondary);
      font-size: 1.1rem;
      margin-bottom: 1rem;
    }

    .note.lead {
      margin-bottom: 2rem;
    }

    ol.note {
      padding-left: 1.5rem;
    }

    a {
      color: var(--button-bg);
    }

    .install-step {
      margin: 15px 0;
      padding-left: 2rem;
    }

    .step-number {
      display: inline-block;
      background: #667eea;
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      text-align: center;
      line-height: 24px;
      margin-left: -2rem;
      margin-right: 0.5rem;
      font-weight: bold;
      float: left;
    }

    .touch-only {
      display: none;
    }

    /* Shown on phones and tablets, where the bookmarklet is awkward */
    .touch-tip {
      display: none;
      margin-bottom: 2rem;
      padding: 1rem 1.25rem;
      border: 2px solid var(--button-bg);
      border-radius: 8px;
      background: var(--bg-secondary);
      font-size: 1.1rem;
    }

    @media (hover: none) and (pointer: coarse) {
      .touch-tip {
        display: block;
      }

      .touch-only {
        display: inline;
      }

      .desktop-only {
        display: none;
      }
    }
  `

  override render() {
    return html`
      <p class="touch-tip">
        ${rich('ss-touch-tip', undefined, { strong: words => html`<strong>${words}</strong>` })}
      </p>
      <p class="note lead">
        ${t('ss-lead')}
      </p>

      <section>
        <h3>${t('ss-install-heading')}</h3>
        <p class="note desktop-only">
          ${rich('ss-drag', undefined, { strong: words => html`<strong>${words}</strong>` })}
        </p>
        <bookmarklet-installer>
          <h4>${t('ss-alt-heading')}</h4>
          <p class="note">
            <span class="desktop-only">${t('ss-alt-text-desktop')}</span
            ><span class="touch-only">${t('ss-alt-text-touch')}</span>
          </p>
          <ol class="note">
            <li>
              <span class="desktop-only">${t('ss-alt-step-1-desktop')}</span
              ><span class="touch-only">${t('ss-alt-step-1-touch')}</span>
            </li>
            <li>${t('ss-alt-step-2')}</li>
            <li>${t('ss-alt-step-3')}</li>
          </ol>
        </bookmarklet-installer>
      </section>

      <section>
        <h3>${t('ss-desktop-heading')}</h3>
        <div class="install-step">
          <span class="step-number">1</span>
          ${rich('ss-desktop-1', undefined, { strong: words => html`<strong>${words}</strong>`, code: words => html`<code>${words}</code>` })}
        </div>
        <div class="install-step">
          <span class="step-number">2</span>
          ${rich('ss-desktop-2', undefined, { strong: words => html`<strong>${words}</strong>` })}
        </div>
        <div class="install-step">
          <span class="step-number">3</span>
          ${t('ss-desktop-3')}
        </div>
        <div class="install-step">
          <span class="step-number">4</span>
          ${t('ss-desktop-4')}
        </div>
      </section>

      <section>
        <h3>${t('ss-mobile-heading')}</h3>
        <p class="note">
          ${t('ss-mobile-1')}
        </p>
        <p class="note">
          ${t('ss-mobile-2')}
        </p>
        <p class="note">
          ${t('ss-mobile-3')}
        </p>
      </section>

      <section>
        <h3>${t('ss-how-heading')}</h3>
        <ol class="note">
          <li>${t('ss-how-1')}</li>
          <li>${t('ss-how-2')}</li>
          <li>
            ${t('ss-how-3')}
          </li>
          <li>${t('ss-how-4')}</li>
          <li>${t('ss-how-5')}</li>
        </ol>
      </section>
    `
  }
}
customElements.define('songselect-help', SongSelectHelp)

declare global {
  interface HTMLElementTagNameMap {
    'songselect-help': SongSelectHelp
  }
}
