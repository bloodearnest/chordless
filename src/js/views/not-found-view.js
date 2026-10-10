import { html } from 'lit'
import '../../components/app-header.js'
import { PageView } from './page-view.js'

/** For a URL that is no page of the app */
export class NotFoundView extends PageView {
  render() {
    return html`
      <app-header heading="Not found"></app-header>
      <main class="home-content">
        <h2 style="margin: 2rem 1rem 1rem 1rem">Page not found</h2>
        <p style="margin: 0 1rem"><a href="/">Go to the setlists</a></p>
      </main>
    `
  }
}
customElements.define('not-found-view', NotFoundView)
