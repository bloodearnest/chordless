# Search

What the library and the add-song modal search does, and what is not built. The TODO has the open items as one-liners.

lyrics full-text search. Built (src/js/utils/song-search.ts, used by `filterSongs`): MiniSearch over
 the songs the library page and the add-song modal already have, with their charts parsed (title,
 artist, variant name, lyrics; each word is indexed as written and stemmed with `stemmer`, in lower
 case without accents or apostrophes, and the very common words are left out). It finds other forms
 of a word ("praises" finds "praise"), a slip of the fingers (fuzzy, on stems of six letters or more:
 on shorter ones "praises" would find "raise"), words in any order (all must be there), and a word
 begun (the last one: as written, or going on from a stem of four letters or more with the start of
 an ending, `ENDINGS`, and a lost "e": "worshippin" finds "worship", "lovi" finds "love"). The words
 found are marked in the title, artist and variant name, and the best line is quoted (`wordRanges`,
 `lyricSnippet`). Songs found by the words alone come after every song the typed letters are in,
 except that a title that has the word is ranked as a title that has the letters (`wordRank`); a
 song found only because a word in it has a letter wrong comes last of all; among lyrics-only
 matches the better score goes first. Checked over many words drawn from the songs, made-up and
 real (docs/TESTING.md, "The search, over many words"). Made in memory, not stored: it is rebuilt when the
 list of songs changes (the library page and the modal make it a moment after the list is shown,
 `warmSearch`), which costs about 0.2 s for 600 songs on a laptop. The list includes songs of the
 device's other databases, so one index covers "From …" songs too, and there is nothing to keep
 up to date after a save, a sync, or leaving a space. Not built:
 - matchLibrary's "line of the song's words" step (src/js/import-plan.ts) still scans; it could use
   the same index (rejoining SongSelect's split syllables is `SPLIT_WORD` in song-filter.ts)
 - if libraries grow so that making the index is felt (thousands of songs, an old iPad), store the
   serialised index (MiniSearch toJSON/loadJSON) in its own IndexedDB store as a derived cache that
   is safe to drop, one per database, updated per chart on save (db.saveChordPro/deleteChordPro)
   and by contentHash after a sync pull, with a version to bump when the tokeniser or stemmer changes
 - rank a title that is the word ("Praise" for "praises") above a title with the word in it
 - a word with an apostrophe for a letter left out ("ev'ry", "pow'r", "heav'n", "ne'er") is found as
   the word it is: indexed with each of a, e, i, o, u, v put back (`lettersPutBack`), and marked the
   same way. Not done: an everyday contraction (Lord's, don't) is left alone, as is an apostrophe at an
   end of a word ("singin'", "'cause", "'neath"), and a letter left out that is not one of those
   six or more than one letter ("fount'n" for "fountain"). Add what a real chart needs
 - a word begun that is only a stem and a short ending ("moti" is "mot" and "i", so "mote") finds
   the odd unrelated word; fine so far, look again if it is noticed
