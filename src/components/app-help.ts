import { css, html, LitElement, nothing } from 'lit'
import type { HelpItem, HelpPage } from '../js/help-content.ts'

/**
 * The Help page: one scroll of short sections, each a list of controls and gestures with what they
 * do (see help-content.ts). Shown in a modal from the menu.
 *
 *   <app-help .page=${helpFor(route)}></app-help>
 */
export class AppHelp extends LitElement {
  static override properties = {
    page: { attribute: false },
  }

  declare page: HelpPage | undefined

  static override styles = css`
    :host {
      display: block;
      /* The modal's body pads it; on a screen wide enough, as much again, as Preferences has */
      padding: 1rem;
      color: var(--text-color, #1a1a1a);
      font-size: var(--font-ui, 1rem);
      line-height: 1.4;
    }

    @media (max-width: 600px) {
      :host {
        padding: 0;
      }
    }

    h3 {
      font-size: var(--font-ui, 1rem);
      margin: 1.5rem 0 0.5rem;
      padding-bottom: 0.25rem;
      border-bottom: 1px solid var(--border-color, #d5dbdb);
    }

    .lead {
      margin: 0 0 1rem;
    }

    .intro {
      margin: 0 0 0.75rem;
    }

    .item {
      margin: 0 0 1rem;
    }

    /* First line: the control as it looks in the app, and its name */
    .control {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.25rem;
    }

    .picture {
      display: block;
      flex-shrink: 0;
      max-width: 100%;
      height: auto;
    }

    /* Of something large: on a line of its own, under the name */
    .picture.wide {
      margin: 0.25rem 0 0.5rem;
    }

    .name {
      font-weight: 600;
    }

    a {
      color: var(--color-primary, #2477ad);
    }

    /* Second line: what it does */
    .text {
      margin: 0;
    }
  `

  /** A picture of the control in the app, in the theme being used (the pictures are 2x) */
  _renderPicture(item: HelpItem) {
    if (!item.image) return nothing
    const dark = document.documentElement.style.colorScheme === 'dark'
    return html`<img
      class=${item.wide ? 'picture wide' : 'picture'}
      src="/help/${item.image}${dark ? '-dark' : ''}.png"
      alt=""
      @load=${this._sized}
      @error=${this._hide}
    />`
  }

  /** Shown at half its size: pictures are taken at twice the pixels, to be sharp */
  _sized(event: Event) {
    const image = event.target as HTMLImageElement
    image.style.width = `${image.naturalWidth / 2}px`
  }

  _hide(event: Event) {
    ;(event.target as HTMLElement).hidden = true
  }

  /**
   * Text that may link inside the app: [Preferences](/preferences). The menu follows the link
   * (see nav-menu.ts), as the modal this is in is not a page the router knows.
   */
  _renderText(text: string) {
    return text.split(/(\[[^\]]+\]\(\/[^)]*\))/).map(piece => {
      const link = /^\[([^\]]+)\]\((\/[^)]*)\)$/.exec(piece)
      return link ? html`<a href=${link[2]}>${link[1]}</a>` : piece
    })
  }

  _renderItem(item: HelpItem) {
    return html`
      <div class="item">
        <div class="control">
          ${item.wide ? nothing : this._renderPicture(item)}
          <span class="name">${item.label}</span>
        </div>
        ${item.wide ? this._renderPicture(item) : nothing}
        <p class="text">${this._renderText(item.text)}</p>
      </div>
    `
  }

  override render() {
    if (!this.page) return nothing
    return html`
      ${this.page.intro.map(paragraph => html`<p class="lead">${paragraph}</p>`)}
      ${this.page.sections.map(
        section => html`
          <section>
            <h3>${section.heading}</h3>
            ${section.intro ? html`<p class="intro">${section.intro}</p>` : nothing}
            ${section.items?.map(item => this._renderItem(item))}
          </section>
        `
      )}
    `
  }
}

customElements.define('app-help', AppHelp)

declare global {
  interface HTMLElementTagNameMap {
    'app-help': AppHelp
  }
}
