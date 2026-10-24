# Chart editor (fix a typo): first pass

Status: a plan, 2026-10-24 (nothing built). The design is in docs/VARIANTS.md, "Editing a chart";
this is the first slice of it: **fix only**, in place. Arrangements (a new variant) come later.

## Starting point

- `overwriteSong(uuid, content, db)` in `src/js/song-utils.ts` already does the save: the ChordPro,
  hash and modified date, the parse cache, the song's metadata. Sync sees the changed hash and
  uploads it, so other devices follow.
- Check first: does `db.saveChordPro` / `saveSong` announce the change on the change bus
  (`data:change`, `src/js/data-changes.ts`, docs/STATE.md)? Auto-sync listens on it.
- The song info dialog (`src/components/song-info-dialog.ts`, opened by `showSongInfo` in
  `setlist-page.ts` and from the library) holds the Versions list: the home for an "Edit chart" button.
- `docs/DATA_MODEL.md` still says songs are immutable; it needs a line saying a fix is in place.

## Plan

1. **`src/components/chart-editor.ts`**: a Lit element in an `app-modal` (fullscreen) with a native
   `<textarea>` of the raw ChordPro, monospace. Save and Cancel. No live preview yet. It fires a
   `chart-editor:save` event with the new text; the parent saves (as `setlist-info-dialog` does).
   Cancelling a changed edit asks first.
2. **`fixChart(uuid, content, db)`** in `song-utils.ts`, wrapping `overwriteSong`: refuse a chart
   that parses to nothing (an empty textarea must not wipe a song); do nothing if the hash is unchanged.
3. **Wiring.** An "Edit chart" button in the song info dialog, for the variant shown. Available live
   too (CLAUDE.md, "permissive in the moment"): the friction is the dialog and the cancel
   confirmation, not edit mode. A failed save is a `toast()` with "Try again", never `alert()`.
   Read-only spaces keep local edits (sync just does not write back). Hidden for songs from another
   database (Shared with me, another space): those need copying first, which is the arrangement path.
4. **Refresh.** The setlist page (`buildRuntimeSongs`) and the library list show the fix without a
   reload. Preferred: listen for `data:change` on the song/chart ids, as `setupChangedSetlists` does
   for setlists; it also shows a fix that arrives by sync. Fallback: the dialog fires an event and the
   page reloads that one song.
5. **Tests** (docs/TESTING.md). Node: `fixChart` changes text, metadata and hash; rejects empty input;
   keeps `uuid` and `variantOf`. Browser unit: the editor's save and cancel events and the
   confirmation. Playwright: edit a lyric in the dialog, save, see it on the song page and in the library.
6. **Docs.** Update VARIANTS.md ("Editing a chart": fix built, arrangement not) and DATA_MODEL.md.
7. **Verify** with `just format lint test`; commit in steps: save function, editor, wiring and
   refresh, docs.

## Open questions

- Entry point: the song info dialog only (proposed), or also a pencil on the song page in edit mode?
- A plain textarea is proposed; anything fancier adds a dependency.

## Later

- A live preview beside the text.
- Save as an arrangement (a new variant, label, author, origin).
- Editing a song from another space or a share (copy first).
- Chord and section helpers in the editor.
