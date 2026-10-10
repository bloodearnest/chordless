import { html } from 'lit'
import '../../components/app-header.ts'
import '../../components/app-preferences.js'
import { PageView } from './page-view.ts'

/** The Preferences page (the menu also opens the same preferences in a modal) */
export class PreferencesView extends PageView {
  render() {
    return html`
      <app-header heading="Preferences"></app-header>
      <main class="home-content">
        <h2 style="margin: 2rem 1rem 1rem 1rem">Preferences</h2>
        <app-preferences id="app-preferences"></app-preferences>
      </main>
    `
  }
}
customElements.define('preferences-view', PreferencesView)
