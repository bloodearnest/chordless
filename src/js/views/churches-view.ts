import { html } from 'lit'
import { t } from '../text.ts'
import '../../components/app-header.ts'
import '../../components/church-console.ts'
import { PageView } from './page-view.ts'

export class ChurchesView extends PageView {
  override render() {
    return html`<app-header heading=${t('church-console-title')}></app-header><main class="home-content"><church-console></church-console></main>`
  }
}
customElements.define('churches-view', ChurchesView)

declare global {
  interface HTMLElementTagNameMap {
    'churches-view': ChurchesView
  }
}
