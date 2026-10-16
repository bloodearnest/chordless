/**
 * What the Help page says, for the page being shown (Menu > Help). One scroll of short sections:
 * how to move around, what the buttons are, and what edit mode adds. Written by hand, so it needs
 * changing when the controls do.
 */
import type { Route } from './router.ts'

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

const OVERVIEW: HelpPage = {
  title: 'Setlist Overview',
  intro: [
    'This is your setlist: the songs for the service, in the order you will play them, each with the key it will be played in.',
    'Tap a song to open its lyrics and chords. Once you are playing you will mostly stay on the songs, and come back here when you want to see the whole list.',
  ],
  sections: [
    {
      heading: 'Getting around',
      items: [
        {
          image: 'overview-card',
          wide: true,
          label: 'Tap a song',
          text: 'Opens its lyrics and chords.',
        },
        {
          label: 'Swipe left (or press →)',
          text: 'Goes to the first song, and on through the setlist from there.',
        },
        {
          image: 'header-menu',
          label: 'Menu',
          text: 'Jump straight to any song in the setlist, or go to your other setlists, the song library and your [preferences](/preferences).',
        },
      ],
    },
    {
      heading: 'While you are playing',
      items: [
        {
          image: 'header-live',
          label: 'Go live',
          text: 'Tell the app you are playing from this setlist. The screen stays awake and the app goes full screen, so nothing gets in the way. It turns red while you are live; tap it again when you are done.',
        },
        {
          image: 'overview-add-song',
          wide: true,
          label: 'Add Song',
          text: 'A song that was not planned? Find it in your library and it goes on the end of the setlist. This is always available, even when you are live.',
        },
      ],
    },
    {
      heading: 'Sharing and details',
      items: [
        {
          image: 'header-share',
          label: 'Share',
          text: 'Make a link that anyone can open to see this setlist, without needing to sign in.',
        },
        {
          image: 'header-info',
          label: 'Information',
          text: 'The setlist’s name, date and notes.',
        },
      ],
    },
    {
      heading: 'Changing the setlist',
      intro:
        'Moving, removing and re-keying songs are kept behind edit mode, so they cannot happen by accident while you are playing. Tap the pencil to turn it on, and again (or press Esc) to turn it off.',
      items: [
        {
          image: 'header-edit',
          label: 'Edit',
          text: 'Turns edit mode on and off.',
        },
        {
          image: 'overview-card-edit',
          wide: true,
          label: 'A song in edit mode',
          text: 'Each song gets a button to remove it, its tempo and key, and a handle to move it by.',
        },
        {
          image: 'overview-reorder',
          label: 'Reorder',
          text: 'Drag a song by its handle to move it up or down the setlist.',
        },
        {
          image: 'overview-key',
          label: 'Key',
          text: 'Choose the key a song will be played in, for this setlist.',
        },
        {
          label: 'BPM',
          text: 'Type the tempo a song will be played at, for this setlist.',
        },
        {
          image: 'overview-remove',
          label: 'Remove',
          text: 'Take a song out of the setlist. It asks first, and the song stays in your library.',
        },
      ],
    },
  ],
}

const SONG: HelpPage = {
  title: 'Setlist Song',
  intro: [
    'This is one song from your setlist: the lyrics, with the chords above them, in the key you will play it in.',
    'When you finish it, swipe to the next. You can show or hide the chords on each section of the song, so the page shows just what you need.',
  ],
  sections: [
    {
      heading: 'Getting around',
      items: [
        {
          label: 'Swipe left or right (or press → and ←)',
          text: 'Goes to the next song, or the one before. Going back from the first song takes you to the overview.',
        },
        {
          label: 'Scroll (or press ↑ and ↓)',
          text: 'A long song carries on below the screen.',
        },
        {
          image: 'header-menu',
          label: 'Menu',
          text: 'Jump straight to any song in the setlist, or go to the overview.',
        },
      ],
    },
    {
      heading: 'About this song',
      items: [
        {
          image: 'song-key',
          label: 'Key, capo and tempo',
          text: 'What you are playing at the top of the page: the key, and the capo, tempo and time signature when the song has them.',
        },
        {
          image: 'header-info',
          label: 'Information',
          text: 'More about the song, such as who wrote it.',
        },
        {
          image: 'song-player',
          wide: true,
          label: 'Player',
          text: 'Play a pad or a click track in the song’s key, to help the band start together. Stop it, or expand it for its settings. It can be turned off in [Preferences](/preferences).',
        },
      ],
    },
    {
      heading: 'Edit mode',
      intro:
        'Changes to the song are kept behind edit mode, so they cannot happen by accident while you are playing. Turn it on, and the page gets two sets of controls: one for each section of the song, and one for the song as a whole. They are described next. Turn it off again to play.',
      items: [
        {
          image: 'header-edit',
          label: 'Edit',
          text: 'Turns edit mode on and off. The Esc key turns it off too.',
        },
      ],
    },
    {
      heading: 'Edit mode: each section of the song',
      intro:
        'Every section of the song (a verse, the chorus, a bridge) gets its own controls, at the top of the section.',
      items: [
        {
          image: 'song-show',
          wide: true,
          label: 'Show',
          text: 'Choose what that section shows: everything, just the lyrics, just the chords, or nothing at all.',
        },
        {
          image: 'song-collapse',
          label: 'Collapse',
          text: 'Fold the section up to a single line, and open it again.',
        },
      ],
    },
    {
      heading: 'Edit mode: the whole song',
      intro: 'The key at the top of the page becomes a button. Tap it to open the song’s settings.',
      items: [
        {
          image: 'song-settings',
          wide: true,
          label: 'Song settings',
          text: 'This is the panel that opens. What is in it is described next.',
        },
        {
          label: 'Key',
          text: 'Choose the key to play in. The song’s own key is marked with a star.',
        },
        {
          label: 'Capo',
          text: 'Choose where the capo goes, with the key the chords are played in at each fret. You can change it once you have turned on capo adjustments in [Preferences](/preferences).',
        },
        {
          label: 'Tempo (BPM)',
          text: 'Slow the song down or speed it up, for the click track.',
        },
        {
          label: 'Pads',
          text: 'Choose which of your pad sets plays for this song. This is there when the player is on.',
        },
        {
          label: 'Reset',
          text: 'Put the song back as it was: its key, capo and which sections are shown. It asks first.',
        },
      ],
    },
  ],
}

const LIBRARY: HelpPage = {
  title: 'Song Library',
  intro: [
    'Every song you can put in a setlist lives here. Search for one, tap it to read it, and use edit mode to set it up the way you like it.',
  ],
  sections: [
    {
      heading: 'Finding a song',
      items: [
        {
          image: 'library-search',
          wide: true,
          label: 'Search',
          text: 'Type part of a title, an artist or some of the lyrics. The search is kept in the address, so a link to it works too.',
        },
        {
          label: 'Tap a song',
          text: 'Opens it, to read its lyrics and chords.',
        },
      ],
    },
    {
      heading: 'Getting around',
      items: [
        {
          label: 'Swipe',
          text: 'Swipe left from the list to the song, and right to come back to the list.',
        },
        {
          label: 'Scroll',
          text: 'Move through the list, or down a long song.',
        },
        {
          image: 'header-menu',
          label: 'Menu',
          text: 'Your setlists, [preferences](/preferences), importing songs and the rest of the app.',
        },
        {
          image: 'header-info',
          label: 'Information',
          text: 'More about the song, such as who wrote it.',
        },
      ],
    },
    {
      heading: 'Edit mode',
      intro:
        'The pencil turns edit mode on, so you can set a song up. What you choose is saved with the song when you turn it off. Turn it on, and you can change the song’s key, and set what each section of it shows.',
      items: [
        {
          image: 'header-edit',
          label: 'Edit',
          text: 'Turns edit mode on and off.',
        },
      ],
    },
    {
      heading: 'Edit mode: the key',
      items: [
        {
          image: 'library-key',
          label: 'Key',
          text: 'Change the key the song is shown in.',
        },
      ],
    },
    {
      heading: 'Edit mode: each section of the song',
      intro: 'Every section of the song (a verse, the chorus, a bridge) gets its own controls.',
      items: [
        {
          image: 'song-show',
          wide: true,
          label: 'Show',
          text: 'Choose what that section shows: everything, just the lyrics, just the chords, or nothing at all.',
        },
        {
          image: 'song-collapse',
          label: 'Collapse',
          text: 'Fold the section up to a single line, and open it again.',
        },
      ],
    },
  ],
}
/** The help for the page the route shows, if there is some yet */
export function helpFor(route: Route | null | undefined): HelpPage | undefined {
  switch (route?.name) {
    case 'setlist':
    case 'share':
      return route.songIndex < 0 ? OVERVIEW : SONG
    case 'songs':
      return LIBRARY
    default:
      return undefined
  }
}
