import { html } from 'lit'
import { t } from '../text.ts'
import '../../components/app-header.ts'
import '../../components/app-speed-test.ts'
import { PageView } from './page-view.ts'

/** The Speed test page: times made-up songs on this device and gives a report to send (docs/SPEED_TEST.md) */
export class SpeedTestView extends PageView {
  override render() {
    return html`
      <app-header heading=${t('speed-test-page')}></app-header>
      <main class="home-content">
        <h2 style="margin: 2rem 1rem 1rem 1rem">${t('speed-test-page')}</h2>
        <app-speed-test id="app-speed-test"></app-speed-test>
      </main>
    `
  }
}
customElements.define('speed-test-view', SpeedTestView)

declare global {
  interface HTMLElementTagNameMap {
    'speed-test-view': SpeedTestView
  }
}
