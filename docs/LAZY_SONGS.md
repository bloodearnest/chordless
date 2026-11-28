# Drawing only the songs near the one in view

A setlist is a row of songs, each as wide as the row, with scroll-snap between them. It used to draw
every song's chart when it opened. On an iPad on iOS 17 that took three seconds for sixteen songs and
twelve for thirty-two: the time grew faster than the setlist (`docs/SPEED_TEST.md`, "What it found"), and
iOS 17 has no `content-visibility` to skip the songs that are off the screen. Now every song has its
place in the row, and only the songs near the one in view have their chart in it.

## What it does

- **A place for every song.** `renderFullSetlist` makes a `div.section#song-N` for every song, with an
  empty `.song-content` in it. The row, the snap points, the section observer, the addresses and the
  overview are the same whatever is drawn.
- **The window.** The song in view, and two either side (`WINDOW_RADIUS`, `js/setlist/song-window.ts`:
  `songsToDraw(current, count)`, nearest first; the overview is before the first song, so it draws
  the first two). A smaller setlist is drawn whole.
- **When it moves.** `_drawAround(index)` draws what is missing from the window. It is called when the
  page opens, and when the song in view changes:
  - `scrollToSection`, which every move made by the page goes through (a tap in the overview, the
    keys, the route changing, the menu): the song to show is drawn *at once*, before the scroll, so
    that no frame shows it empty;
  - the section observer, for a swipe: the song swiped to is already drawn, and the next ones are
    drawn now;
  - moving a song in the setlist, which makes other songs the near ones.
  The ones that are not the song in view are drawn one a frame, nearest first, so that no frame draws
  more than a song; a new call drops what the last left to do, as the person has gone elsewhere.
- **One way to draw a song.** `_drawSong(index)` makes the `song-display` as the page has capo, tuning,
  pitch and annotations now (`_makeSongDisplay`, which editing a song also uses), waits for it to
  render, applies the section states (`sections.applyAll(section)`), puts back how far the song was
  scrolled if the page was restored with that (`_scrollsWhenDrawn`), and, if the song is shown as its
  lead sheet, draws that. The loops that give every `song-display` a new capo, tuning or pitch only
  touch the ones that are drawn; a song drawn later gets the current value from the same function.
- **An edit to a song that is not drawn** (a key change, a text edit) changes the data and does not
  draw it: it is drawn with the new text when it is near.
- **`content-visibility: auto`** is also on the songs' places in the row, where the browser has it
  (`@supports`, `style.css`): a song that is drawn and off the screen is not laid out or painted. Its
  size is the row's (`width` and `height` of 100%), so it needs no placeholder size. Safari before 18
  has none, which is why the window exists too: `content-visibility` skips layout and paint, and the
  window also skips making the elements and rendering the components.

## What it does not do

- **It does not take songs away.** A song stays drawn once it is. After a service in which every song
  was visited every song is drawn, as before. Taking the far ones away (past two more songs than the
  window), with their scroll position kept, is the next step, to be made only if the reports say
  that it matters (below).
- **Browser find and screen readers cannot see a song that is not drawn.** A song is reached by the
  overview, the route or a swipe, each of which draws it.
- **It does not make a song cheaper to draw.** The cost per song is still not understood
  (`docs/SPEED_TEST.md`); this caps how many are drawn at once.

## How to tell whether it worked

`chordless.setlist.drawn` on the `chordless.setlist.open` span is how many songs were drawn at first
(`chordless.setlist.songs` is how many there are). `chordless.setlist.first_paint_ms` and `.settled_ms`
are now of what was drawn, not of the whole setlist, so they should stop growing with the setlist:
`P50(chordless.setlist.settled_ms)` by `chordless.setlist.songs`, where `os.name` is `iPadOS`, before and
after. `chordless.perf.long_frames` on the leave span says whether the rest of a service is smooth, and,
if it gets worse towards the end of a long setlist, that songs ought to be taken away again.

## Risks that were looked for

- Tests that assume every song is drawn (about a dozen): the test harness draws every song after it
  opens the page, unless a test asks for `windowed`, and `tests/setlist-page-lazy.test.ts` is of the
  window itself.
- A song reached before it is drawn: the cases are the page opening on a song (`/setlist/<id>/song/9`
  draws 7 to 9 before it scrolls there), a tap in the overview, a swipe, and the route changing.
- Melody mode (a song shown as its lead sheet) draws the song first if it is not drawn.
- Lazily drawn songs have the same section states, capo, tuning, pitch and annotations as the others
  (`tests/setlist-page-lazy.test.ts`).
