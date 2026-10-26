# Mobile UI

**Status: step 1 and 3 built (the layout below); step 2 (key chip, live mode collapse) not.** Written 2026-10-21 from a talk about the header on narrow screens.

## The problem

Below 48rem the header (`src/components/app-header.ts`) is two rows. Row 1 is the menu button, the
title and a ▼ toggle. Row 2 holds the controls and stays hidden until the toggle is pressed. On the
setlist page row 2 is up to six items: Go live, differs, share, the key/capo/BPM display (which opens
the song settings popover), edit and info.

The user does not like hiding them behind a toggle. But the header is sticky, so we do need to minimise the space it takes up by reducing whitespace

## The mobile use case

Mostly **lyrics only, no chords**: a phone has no room for them. So the musical metadata (key, capo,
BPM) matters less there, and live mode can take more of the controls out of the way.

## Plan

### 1. Two rows on narrow screens, no toggle (built)

- Top row: menu, title, then the icons (go live, differs, share, edit, info). Second row: the
  song's key, BPM and time, left-aligned. The ▼ toggle, `expanded` and `HeaderExpandToggleEvent`
  are gone.
- The second row is only there when it has something in it: the setlist overview and the library
  show one row.
- On tablet and desktop it is still one row (the controls before the icons).

### 2. Less vertical whitespace (built)

- The header's padding and gaps are `calc(var(--font-base) * 0.4)`, not `rem`: the text follows
  `--font-base` (the screen's width), so the space does too.
- Phone padding is half a gap above and below; no gap between the rows.

### 3. Less in the header on mobile (not built)

- **Key chip.** With chords hidden, drop the full key/capo/BPM display from the header and leave a
  small key chip, so a singer can still see the key. The chip opens the song settings popover, so a
  late key change stays one tap away (CLAUDE.md: permissive in the moment).
- **Live mode thins the icons** on mobile to the red Go live button and the key chip. Edit, info,
  share and differs move behind one "more" tap (or the menu button). Demoted, never removed. Edit
  mode is already the guard against accidents, which is the reason to move edit and share while live.
  Not live, the full row shows. See [LIVE_MODE.md](LIVE_MODE.md): the header's Go live button is the
  only live indicator.

## Open questions

- Chip: only while chords are hidden, or always on mobile? Leaning always: a key you can't see is a
  key you can't check.
- A "more" button for the demoted controls is a small version of the dropdown the user disliked,
  though it would only appear while live. Alternative: the menu button, or a tap on the title.
