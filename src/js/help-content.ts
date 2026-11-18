/**
 * What the Help page says, for the page being shown (Menu > Help). One scroll of short sections:
 * how to move around, what the buttons are, and what edit mode adds. Written by hand, so it needs
 * changing when the controls do. The words are in the catalogue (src/text/en.ts, `help-…`: page, section,
 * item); what stays here is the shape, and which picture goes with which item. Each page is a function, so
 * that an edit of the words in the dev editor shows the next time the page is opened.
 */

import type { Route } from './router.ts'
import { t } from './text.ts'

/**
 * A control or a gesture: its name and what it does and, if there is something on screen to
 * show, a picture of it from the real app (`image`, a name in public/help/, taken by
 * `just help-images`). A gesture or a key has no picture, and shows just its name. `wide` is for
 * a picture of something large (a song's card, a panel), which has a line to itself.
 */
export interface HelpItem {
  image?: string
  wide?: boolean
  label: string
  text: string
}

export interface HelpSection {
  heading: string
  intro?: string
  items?: HelpItem[]
}

export interface HelpPage {
  /** The page's name: the menu says "Help: <title>", and the modal is headed by it */
  title: string
  /** What the page is for: a paragraph or two before the sections */
  intro: string[]
  sections: HelpSection[]
}

const overview = (): HelpPage => ({
  title: t('help-overview-title'),
  intro: [t('help-overview-intro-1'), t('help-overview-intro-2')],
  sections: [
    {
      heading: t('help-overview-getting-around-heading'),
      items: [
        {
          image: 'overview-card',
          wide: true,
          label: t('help-overview-getting-around-tap-a-song-label'),
          text: t('help-overview-getting-around-tap-a-song-text'),
        },
        {
          label: t('help-overview-getting-around-swipe-left-or-press-label'),
          text: t('help-overview-getting-around-swipe-left-or-press-text'),
        },
        {
          image: 'header-menu',
          label: t('help-overview-getting-around-menu-label'),
          text: t('help-overview-getting-around-menu-text'),
        },
      ],
    },
    {
      heading: t('help-overview-while-you-are-playing-heading'),
      items: [
        {
          image: 'header-live',
          label: t('help-overview-while-you-are-playing-go-live-label'),
          text: t('help-overview-while-you-are-playing-go-live-text'),
        },
        {
          image: 'overview-add-song',
          wide: true,
          label: t('help-overview-while-you-are-playing-add-song-label'),
          text: t('help-overview-while-you-are-playing-add-song-text'),
        },
      ],
    },
    {
      heading: t('help-overview-sharing-and-details-heading'),
      items: [
        {
          image: 'header-share',
          label: t('help-overview-sharing-and-details-share-label'),
          text: t('help-overview-sharing-and-details-share-text'),
        },
        {
          image: 'header-info',
          label: t('help-overview-sharing-and-details-information-label'),
          text: t('help-overview-sharing-and-details-information-text'),
        },
      ],
    },
    {
      heading: t('help-overview-changing-the-setlist-heading'),
      intro: t('help-overview-changing-the-setlist-intro'),
      items: [
        {
          image: 'header-edit',
          label: t('help-overview-changing-the-setlist-edit-label'),
          text: t('help-overview-changing-the-setlist-edit-text'),
        },
        {
          image: 'overview-card-edit',
          wide: true,
          label: t('help-overview-changing-the-setlist-a-song-in-edit-mode-label'),
          text: t('help-overview-changing-the-setlist-a-song-in-edit-mode-text'),
        },
        {
          image: 'overview-reorder',
          label: t('help-overview-changing-the-setlist-reorder-label'),
          text: t('help-overview-changing-the-setlist-reorder-text'),
        },
        {
          image: 'overview-key',
          label: t('help-overview-changing-the-setlist-key-label'),
          text: t('help-overview-changing-the-setlist-key-text'),
        },
        {
          label: t('help-overview-changing-the-setlist-bpm-label'),
          text: t('help-overview-changing-the-setlist-bpm-text'),
        },
        {
          image: 'overview-remove',
          label: t('help-overview-changing-the-setlist-remove-label'),
          text: t('help-overview-changing-the-setlist-remove-text'),
        },
      ],
    },
  ],
})

const song = (): HelpPage => ({
  title: t('help-song-title'),
  intro: [t('help-song-intro-1'), t('help-song-intro-2')],
  sections: [
    {
      heading: t('help-song-getting-around-heading'),
      items: [
        {
          label: t('help-song-getting-around-swipe-left-or-right-or-press-label'),
          text: t('help-song-getting-around-swipe-left-or-right-or-press-text'),
        },
        {
          label: t('help-song-getting-around-scroll-or-press-and-label'),
          text: t('help-song-getting-around-scroll-or-press-and-text'),
        },
        {
          image: 'header-menu',
          label: t('help-song-getting-around-menu-label'),
          text: t('help-song-getting-around-menu-text'),
        },
      ],
    },
    {
      heading: t('help-song-about-this-song-heading'),
      items: [
        {
          image: 'song-key',
          label: t('help-song-about-this-song-key-capo-and-tempo-label'),
          text: t('help-song-about-this-song-key-capo-and-tempo-text'),
        },
        {
          image: 'header-info',
          label: t('help-song-about-this-song-information-label'),
          text: t('help-song-about-this-song-information-text'),
        },
        {
          image: 'song-player',
          wide: true,
          label: t('help-song-about-this-song-player-label'),
          text: t('help-song-about-this-song-player-text'),
        },
      ],
    },
    {
      heading: t('help-song-edit-mode-heading'),
      intro: t('help-song-edit-mode-intro'),
      items: [
        {
          image: 'header-edit',
          label: t('help-song-edit-mode-edit-label'),
          text: t('help-song-edit-mode-edit-text'),
        },
      ],
    },
    {
      heading: t('help-song-edit-mode-each-section-of-the-heading'),
      intro: t('help-song-edit-mode-each-section-of-the-intro'),
      items: [
        {
          image: 'song-show',
          wide: true,
          label: t('help-song-edit-mode-each-section-of-the-show-label'),
          text: t('help-song-edit-mode-each-section-of-the-show-text'),
        },
        {
          image: 'song-collapse',
          label: t('help-song-edit-mode-each-section-of-the-collapse-label'),
          text: t('help-song-edit-mode-each-section-of-the-collapse-text'),
        },
      ],
    },
    {
      heading: t('help-song-edit-mode-the-whole-song-heading'),
      intro: t('help-song-edit-mode-the-whole-song-intro'),
      items: [
        {
          image: 'song-settings',
          wide: true,
          label: t('help-song-edit-mode-the-whole-song-song-settings-label'),
          text: t('help-song-edit-mode-the-whole-song-song-settings-text'),
        },
        {
          label: t('help-song-edit-mode-the-whole-song-key-label'),
          text: t('help-song-edit-mode-the-whole-song-key-text'),
        },
        {
          label: t('help-song-edit-mode-the-whole-song-capo-label'),
          text: t('help-song-edit-mode-the-whole-song-capo-text'),
        },
        {
          label: t('help-song-edit-mode-the-whole-song-tempo-bpm-label'),
          text: t('help-song-edit-mode-the-whole-song-tempo-bpm-text'),
        },
        {
          label: t('help-song-edit-mode-the-whole-song-pads-label'),
          text: t('help-song-edit-mode-the-whole-song-pads-text'),
        },
        {
          label: t('help-song-edit-mode-the-whole-song-reset-label'),
          text: t('help-song-edit-mode-the-whole-song-reset-text'),
        },
      ],
    },
    {
      heading: t('help-song-edit-mode-annotations-heading'),
      intro: t('help-song-edit-mode-annotations-intro'),
      items: [
        {
          image: 'song-annotation',
          wide: true,
          label: t('help-song-edit-mode-annotations-press-and-hold-label'),
          text: t('help-song-edit-mode-annotations-press-and-hold-text'),
        },
        {
          image: 'annotation-editor',
          wide: true,
          label: t('help-song-edit-mode-annotations-the-annotation-label'),
          text: t('help-song-edit-mode-annotations-the-annotation-text'),
        },
        {
          label: t('help-song-edit-mode-annotations-change-or-delete-an-annotation-label'),
          text: t('help-song-edit-mode-annotations-change-or-delete-an-annotation-text'),
        },
        {
          label: t('help-song-edit-mode-annotations-an-annotation-for-the-whole-song-label'),
          text: t('help-song-edit-mode-annotations-an-annotation-for-the-whole-song-text'),
        },
      ],
    },
  ],
})

const library = (): HelpPage => ({
  title: t('help-library-title'),
  intro: [t('help-library-intro-1')],
  sections: [
    {
      heading: t('help-library-finding-a-song-heading'),
      items: [
        {
          image: 'library-search',
          wide: true,
          label: t('help-library-finding-a-song-search-label'),
          text: t('help-library-finding-a-song-search-text'),
        },
        {
          label: t('help-library-finding-a-song-tap-a-song-label'),
          text: t('help-library-finding-a-song-tap-a-song-text'),
        },
      ],
    },
    {
      heading: t('help-library-getting-around-heading'),
      items: [
        {
          label: t('help-library-getting-around-swipe-label'),
          text: t('help-library-getting-around-swipe-text'),
        },
        {
          label: t('help-library-getting-around-scroll-label'),
          text: t('help-library-getting-around-scroll-text'),
        },
        {
          image: 'header-menu',
          label: t('help-library-getting-around-menu-label'),
          text: t('help-library-getting-around-menu-text'),
        },
        {
          image: 'header-info',
          label: t('help-library-getting-around-information-label'),
          text: t('help-library-getting-around-information-text'),
        },
      ],
    },
    {
      heading: t('help-library-edit-mode-heading'),
      intro: t('help-library-edit-mode-intro'),
      items: [
        {
          image: 'header-edit',
          label: t('help-library-edit-mode-edit-label'),
          text: t('help-library-edit-mode-edit-text'),
        },
      ],
    },
    {
      heading: t('help-library-edit-mode-the-key-heading'),
      items: [
        {
          image: 'library-key',
          label: t('help-library-edit-mode-the-key-key-label'),
          text: t('help-library-edit-mode-the-key-key-text'),
        },
      ],
    },
    {
      heading: t('help-library-edit-mode-each-section-of-the-heading'),
      intro: t('help-library-edit-mode-each-section-of-the-intro'),
      items: [
        {
          image: 'song-show',
          wide: true,
          label: t('help-library-edit-mode-each-section-of-the-show-label'),
          text: t('help-library-edit-mode-each-section-of-the-show-text'),
        },
        {
          image: 'song-collapse',
          label: t('help-library-edit-mode-each-section-of-the-collapse-label'),
          text: t('help-library-edit-mode-each-section-of-the-collapse-text'),
        },
      ],
    },
  ],
})

/** The help for the page the route shows, if there is some yet */
export function helpFor(route: Route | null | undefined): HelpPage | undefined {
  switch (route?.name) {
    case 'setlist':
    case 'share':
      return route.songIndex < 0 ? overview() : song()
    case 'songs':
      return library()
    default:
      return undefined
  }
}
