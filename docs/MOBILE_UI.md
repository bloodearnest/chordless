# Mobile UI

**Status: idea, nothing built.** Written 2026-10-21 from a talk about the header on narrow screens.

## The problem

Below 48rem the header (`src/components/app-header.ts`) is two rows. Row 1 is the menu button, the
title and a ▼ toggle. Row 2 holds the controls and stays hidden until the toggle is pressed. On the
setlist page row 2 is up to six items: Go live, differs, share, the key/capo/BPM display (which opens
the song settings popover), edit and info.

The user does not like hiding them behind a toggle. But the header is sticky, so we do need to minimise the space it takes up by reducing whitespace

## The mobile use case

Mostly **lyrics only, no chords**: a phone has no room for them. So the musical metadata (key, capo,
BPM) matters less there, and live mode can take more of the controls out of the way.

## Plan, in two steps

### 1. Always show the second row on narrow screens

- Remove the ▼ toggle, the `expanded` property, `HeaderExpandToggleEvent` and whatever listens to them.
- Row 2 is always shown; `flex-wrap: wrap` instead of `nowrap`, so a crowded set wraps to a third
  line rather than overflowing.
- Remove the `!important` overrides that force the controls visible when expanded, and the shrunken
  `.icon-button` in `:host([expanded])`. Keep 44px touch targets.
- Cost: one or two rows of height above the lyrics, at the top of the page only.

### 2. Less in the header on mobile

- **Key chip.** With chords hidden, drop the full key/capo/BPM display from the header and leave a
  small key chip, so a singer can still see the key. The chip opens the song settings popover, so a
  late key change stays one tap away (CLAUDE.md: permissive in the moment).
- **Live mode collapses row 2** on mobile to the red Go live button and the key chip. Edit, info,
  share and differs move behind one "more" tap (or the menu button). Demoted, never removed. Edit
  mode is already the guard against accidents, which is the reason to move edit and share while live.
  Not live, the full row shows. See [LIVE_MODE.md](LIVE_MODE.md): the header's Go live button is the
  only live indicator.

### 3. Reduce vertical whitespace in header.

- It's too much atm.

## Open questions

- Chip: only while chords are hidden, or always on mobile? Leaning always: a key you can't see is a
  key you can't check.
- A "more" button for the demoted controls is a small version of the dropdown the user disliked,
  though it would only appear while live. Alternative: the menu button, or a tap on the title.
