# Key detection

Status: a plan (nothing here is built yet). Written 2026-10-24 from an analysis of the Gateway
export of 2026-10-24 (149 songs). Decisions marked "open" are still the user's.

## Problem

A chart's `{key:}` is taken as it comes (`song-utils.ts`: `key` and `originalKey` both copy
`metadata.key`). Nothing checks it. The key matters for two things: transposing (the key list is
built around it, `transpose.ts`) and which pad plays (`pad-keys.ts`, `pad-set-service.ts`). A wrong
key gives a wrong pad and a wrong transpose target.

Three ways a chart's key is wrong:

1. **The key is a different degree of the right scale.** Taken from the first chord, which is IV or V
   (Way Maker starts on A in E; Build Your Kingdom Here starts on D in A).
2. **I against vi.** A chart in G that says Em, or the reverse. Sometimes home really is vi; sometimes
   the first chord is just vi (or vii) in a song that is in I.
3. **A mode or a deliberate choice.** Revelation Song says D ("the composer has confirmed the tonal
   center is D and the mode is Mixolydian"), but every chord is in G major, it ends on G, and a
   leader wants a G pad. This is a preference, not an error.

Two charts in the export have no `{key:}` at all (Be Strong And Courageous, untitled).

## What the export showed

Prototype (throwaway script, not in the repo) over the 149 charts:

- First chord is the declared key in 101 songs, and is not in 47. SongSelect's keys were right in
  those, so the first chord is a poor key signal, and SongSelect charts mostly need no help. The
  problem is pasted charts, email attachments, other ChordPro and charts with no key.
- Krumhansl-Schmuckler (pitch-content key finding) agreed with the declared key on 139 of 149. Of
  the 10 that differed, 9 were the finder picking V when I and V are both prominent (Holy Holy,
  All Hail The Lamb, Refiner's Fire), so plain K-S is not good enough for the tonic.
- Revelation Song was the one real disagreement: all chords fit G major, the song ends on G.
- Scale fit (the share of chords whose tones all lie in a major scale) was 100% for most songs and
  gave one scale for most. Here Is Love fits D and G equally and needs a tiebreak. Awesome God
  and Solid Ground fit poorly (55%, 73%): odd chords or key changes.

## Design

Detection answers three questions in order. Only the first is reliable.

### 1. Which scale

Score each of the 12 major scales by the fraction of chords wholly inside it (relative minors share
a scale, so I and vi are not told apart here). Chord tones: root, third (major, minor, sus), fifth,
and seventh when named. Slash-chord bass notes count too. Ignore chords in `[( )]` and bar
markers `[|]`.

- One clear winner (higher by a few points) is the scale.
- A tie (Here Is Love) goes on to question 2 and 3.
- Best fit under about 80% means key changes or non-diatonic chords: suggest nothing.

### 2. Is the declared key in that scale

If the declared key's note is not in the best-fit scale, the key is wrong. Say so and offer the
tonic from question 3. If it is in the scale, go on.

### 3. Which degree is home

Only I or vi are candidates for the tonic (pad and transpose both want one of them). Pick between
them with weighted evidence:

| Signal | Weight |
|---|---|
| The declared key is I or vi of the scale | strong; keeps the author's choice |
| The last chord of the song | strong |
| The last chord of each section, and the chord before a repeat | medium |
| Count of chord roots on I against vi | medium |
| V to I (or V to vi) at section ends | medium |
| The first chord | weak (the thing we do not trust) |

If the declared key is I or vi and nothing contradicts it clearly, report nothing. Suggest a
change only when the evidence beats the declared key by a clear margin and say why in the text,
for example "Ends on G and all chords fit G major".

Do not run K-S for the tonic: it gave V wrongly.

### Outputs

For each chart, one of:

- `agrees`: show nothing.
- `suggest {key, reason}`: the declared key was off the scale, or the evidence for another I or vi is
  clear. Offered, never applied alone.
- `unknown`: too little fit, or no chords. Show nothing.

## Using it

- **Import**: the preview offers "Looks like it's in G (ends on G, all chords fit G major). Use G?"
  with a one-tap accept. A chart with no key gets the suggestion as the key (the only case that is
  applied without a tap, as there is nothing to lose), marked as detected.
- **Stored separately**: `originalKey` stays what the file said (reset goes back to it). A new
  optional `detectedKey` holds the suggestion and `tonic` is the user's override of the pad and
  transpose home. All of it stays on the song record and syncs like the other fields.
- **Pad**: the pad key is the declared key if it is I or vi of the best-fit scale, otherwise the
  suggested one, always replaceable by the user's own choice for the song. A pad on vii is
  never chosen by itself. (Open: a per-song pad key, separate from the transposed key.)
- **Transpose**: the key list is built from the effective key (user's, else the declared one, else
  the detected one).
- **Permissive**: never blocking, never silent. The suggestion can be ignored; a chart edit or
  key change at any time is still free. For existing charts there is a "check the key" action
  in the song's edit menu, not a bulk rewrite of the library.

## Revelation Song

The chart says D (Mixolydian); all chords are in G major; it ends on G. Question 1 gives G. The
declared D is in the scale, so question 2 passes; in question 3 D is neither I nor vi of G, and
the ending evidence prefers G, so the suggestion is "Looks like it's in G". Accepting gives a G pad.
Declining keeps D, which is what the composer says, and the user can still set the pad alone.

## Limits

- Modal songs and charts with no clear ending are judgement calls; the reason text must say what
  the evidence was.
- Songs that change key partway fit no single scale. They fall under the 80% bar and get no
  suggestion. Per-section keys are out of scope.
- Chord vocabulary: add 6, 9, add and dim7 to the tone table before relying on the fit.
- Minor-tonic songs (vi) are the least certain; start with a high bar for suggesting vi over I.

## Tests

The tonic step is untested; the scale step is prototyped only. Build a labelled fixture of about 20
songs from the export (not stored: the charts are copyrighted, so keep the chord progressions
only) covering: first chord IV, first chord V, first chord vi, home really vi, no key, key changes,
and Revelation Song. Test the fit, the decision and the reason text separately. Run the same
fixture over the whole export as a report (agrees, suggest, unknown counts) to catch a rule that
suggests too often.

## Open

- Whether the pad key may differ from the song's displayed key.
- Whether to run detection on already-imported charts in the background (suggest only).
- The 80% bar and the margins: set from the fixture, not guessed.
