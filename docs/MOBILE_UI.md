# Mobile UI

**Status: the header layout is built; the key chip and live mode's thinner header are not.**
Written 2026-10-21 from a talk about the header on narrow screens; the layout below shipped on 2026-10-26.

## The mobile use case

Mostly **lyrics only, no chords**: a phone has no room for them. So the musical metadata (key, capo,
BPM) matters less there, and live mode can take more of the controls out of the way.

## The header below 48rem (built)

`src/components/app-header.ts`. On a tablet or desktop it is one row, the controls before the icons.

- **Top row:** menu, title, then the icons (go live, differs, share, edit, info). Nothing is hidden
  behind a toggle.
- **Second row:** on a song, the key, BPM and time, from the menu icon's left edge (`--edge`: the
  button's padding and the space the icon leaves round its lines). On the overview, the setlist's
  name, or its type if it has no name (`subheading`); the top row's title is then the short date
  ("18 Oct", `phoneHeading`). Wider screens show "Sun 18 Oct - Name" as one title. The row is
  there only when it has something in it, so the library shows one row.
- **Same height** for the overview's second row and a song's, so the header does not jump between
  them. The title and the rows change while faded out.
- **Spacing** follows the text, not `rem`: padding and gaps are `calc(var(--font-base) * 0.4)`
  (`--font-base` is the screen's width). The icons (2.5rem round buttons, a 44px menu button) and
  the text are full size: they were squeezed smaller first and were too small to use. The header
  is about 83px.
- **It tucks away while a song scrolls down, and comes back scrolling up**, as a browser's address
  bar does (`src/js/setlist/header-autohide.ts`; phones only). CSS alone can't: scroll-driven
  animations don't know the direction, and are not in the Safari 17 floor. It slides up by a
  negative `margin-top` set from the script (the page's reset beats a `:host` margin), so the lyrics
  move with it and do not re-fit. It is always shown at the top of a song, on the overview, and
  when moving to another song. A move leaves the scrolling alone for 350 ms: the lyrics grow or
  shrink with it, which at the end of a song looks like a scroll the other way.

## Still to do

- **Key chip.** With chords hidden, drop the full key/capo/BPM display from the header and leave a
  small key chip, so a singer can still see the key. The chip opens the song settings popover, so a
  late key change stays one tap away (CLAUDE.md: permissive in the moment).
- **Live mode thins the icons** on mobile to the red Go live button and the key chip. Edit, info,
  share and differs move behind one "more" tap (or the menu button). Demoted, never removed. Edit
  mode is already the guard against accidents, which is the reason to move edit and share while live.
  Not live, the full row shows. See [LIVE_MODE.md](LIVE_MODE.md): the header's Go live button is the
  only live indicator.

### Open questions

- Chip: only while chords are hidden, or always on mobile? Leaning always: a key you can't see is a
  key you can't check.
- A "more" button for the demoted controls is a small version of the dropdown that was disliked,
  though it would only appear while live. Alternative: the menu button, or a tap on the title.
- A tucked header can't be reached (menu, edit) until the song is scrolled up a little. A tap on
  the top edge could bring it back.
