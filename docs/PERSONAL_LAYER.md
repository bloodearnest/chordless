# The shared setlist and the personal layer

Who may change what in a setlist, and what each person keeps for themselves. Written 2026-11-13 when
the app first had to be thought of for several people: until then it had one user, who was the leader,
the writer and the reader all at once, and the design mixed the three up. **Designed, not built**
(except where it says so); what is built today is in "Today", below.

The principle is in CLAUDE.md: *be permissive in the moment*. Nobody is stopped from adapting what they
see to how they play; rights only decide **what reaches the shared setlist**. This is the model that
makes both true.

## The model

A setlist has two layers.

- **The shared setlist** is in Drive. It is the leader's plan for the day: which songs, in which order, in
  which key and at which tempo, the notes on them, and the annotations meant for everyone.
- **The personal layer** is on each device and never synced: how this person plays it. It is kept in the
  setlist's local state (`setlist_local`), which a pull never touches.

Nothing needs merging between them. A person's changes are in the layer, the shared setlist is the
leader's, and the sync only ever sends the leader's.

## Who controls a setlist

The people who may change the shared setlist are:

- **its leader**: the setlist's `leaderId` is a person whose address is the signed-in account's, as
  `mayDeleteSetlist` and the Worker's delete rule already decide it;
- **a team admin or the owner**, for any setlist of the team. This covers the leader's device being
  broken: no new machinery;
- **you, in a personal space, always**, whoever the setlist records as its leader.

Everyone else, writers who are not its leader and readers alike, has the personal layer and nothing more.
They see the setlist, play it, and fit it to themselves.

(What the **writer** role means follows from this: a writer makes setlists and leads them, and adds songs and
fixes charts in the library. A reader does neither (pads may be added by any member). Neither changes
someone else's setlist.)

## What is shared, and who changes it

Only the people above change these:

- the songs in the setlist, their order, and removing one;
- each song's **key** and **tempo**, and which **variant** of the song it uses;
- the setlist's details (date, type, name, leader);
- **shared annotations**: those made with "Everyone" (`SetlistEntry.annotations`).

The point is **protection against accidents**, not a question of trust: a key knocked while someone tries
to scroll should not reach the whole band. So the controls are not offered to anyone else. The Worker
could enforce it (it can read a setlist's leader, as the delete rule does); that is left until it is
wanted, and the client's check is advisory, as other rules are.

A last-minute change must still be possible for the leader, and for the person who has to cover for them
(an admin). For everyone else the personal layer is the way to adapt, which is why it has to be good.

## What is personal

Never synced, never exported. All of it is the person's own and nobody else's business.

- **How I play it** (below): the tuning or pitch of my instrument, and a capo, so the chords shown fit
  how I play. Not the setlist's key, which is the leader's.
- **Songs added locally.** Anyone may add a song to a setlist for themselves, which is the congregation
  member starting a song a cappella, offline. It is kept in the layer, shown after the song it was added
  after, and never sent. Its key and tempo are the person's own. They can remove it, and only
  what they added: the shared songs are not theirs to remove.
- **Private annotations** ("Just me"), as now (`annotations/store.ts`). Only the people who control a
  setlist can make one "Everyone".
- **Section display**, as now: which sections show chords or lyrics, which are hidden or collapsed.
- **The device's own preferences**: pads, the click, the theme.

## Editing songs

A song is edited in the **library**, not in a setlist, and a setlist keeps no edits of a chart of its own
(`chordproEdits`, which nothing wrote, was removed). Two things change a chart:

- **A typo fixed**: the chart changes for everyone, in every setlist that uses it.
- **A variant made**: another version of the song, which a setlist's owner may choose for it. A person's
  own variant that only they see is not designed.

Who may: **writers and up** in a team, in their own space anyone. A reader cannot; as now, their change
stays on the device and is held back from sync. A version and edit history, to see and undo what changed,
belongs to the design of editing charts, which is not written.

## How I play it

One question, asked at first use and in Preferences, **"What do you play?"**, decides which of a few
independent controls are on. It is a set of presets over switches, so that a person can also set each
switch themselves (**Custom**). Everything here is on the device and never synced.

| Type | Lyrics only to start | Capo and tuning | Instrument pitch |
|---|---|---|---|
| Singer or drummer | yes | no | no |
| Guitarist | no | yes | no |
| Transposing instrument | no | no | yes |
| Other (keys, bass, anything at concert pitch) | no | no | no |
| **Custom** | the person's choice | the person's choice | the person's choice |

Choosing a type sets the switches; Custom shows them to change one by one. (They are already separate
settings today: the musician type, the sections' defaults, and whether the capo control shows. A type is a
preset that sets them, not a fact kept beside them.) A person with the capo on becomes a guitarist, one
who chose lyrics only a singer, anyone else "Other".

**Guitarist.** Two things move the shapes, and they add:
- **Tuning**, for a guitar tuned down: standard, half step down, whole step down. A device default
  ("I always tune down"), and one for **this setlist** ("tuned down tonight") that wins over it.
- **Capo**, per song, 0 to 11, as now. It is added to the tuning, and the song's header shows the total, so
  it is clear what is being applied: tuned a half step down with a capo 2 plays as a capo 1.

**Transposing instrument.** The **instrument pitch**: Concert, B♭, E♭ or F (for the chords: a B♭ horn
reads up a whole step, an E♭ up a sixth, an F up a fifth). A device default ("I play alto sax"), one for
**this setlist** ("B♭ sax this week") that wins over it, and one for **a song** that replaces both for
that song (the song where the horn is swapped). The key shown is the shared key plus the offset.

**Singer, and Other:** none of this, and nothing in the header for it.

**Where each is set.** The type, the switches and the device defaults are in **Preferences**. The setlist's
tuning or pitch is a row on the **setlist overview**, shown to people who have that control and editable
in edit mode, as the rest of the setlist's settings are. A song's capo or pitch is in the song's header,
as the capo is now.

**Not covered:** only offsets, so drop D and other tunings that change the shapes and not the key are not;
and the lead sheet's notes, which a horn player reads at their pitch too: separate, later. Working names:
"Tuning", "Instrument", "Capo" and "Pitch"; "My key" was considered and is a letter, not an offset.

## What goes away, and what changes

- **A writer's change of key or tempo on someone else's setlist** is no longer offered. Today any writer
  can. The person's way to a different key is how they play it (above).
- **The read-only reset path** (a reader's changes replaced by the leader's, the "differs from official"
  button, the revert) has nothing to do once non-owners have no shared edits: a person's changes are in
  the layer, and nothing is replaced. It is removed with the layer.
- **Conflicts become rare**: only the leader and someone covering for them can write the setlist's file.
  Drive wins stays the rule, and the Worker's 409 on a write over a change made since the pull (built)
  guards it. What is missing is telling the person whose change lost; a small notice, later.
- **A merge for a setlist changed on both sides** (a leader's version as the base, the other's songs and
  annotations added) was built as a pull request and **not merged**: with this model there is nothing
  for it to do.

## Not decided

- **Other writers changing the core properties.** The simple version above says they cannot. If teams
  want it, the options are, in the order I would try them: **suggestions** (a writer proposes, the leader
  accepts each change: designed in SYNC_ARCHITECTURE.md), a **stand-in** (a writer confirms they are
  changing it for the leader), and an **editors list** the leader chooses. None before the simple version
  has been used by several people.
- **Hiding a shared song for oneself** (skipping one that does not apply to them). Not designed.
- **A personal variant** of a chart.

## Today

What is built and will change:

- A writer's key, tempo, order and removal edit the shared setlist; a reader's stay on the device and
  are replaced when the leader changes the setlist (docs/SPACES.md, "Read-only").
- Capo (per song, 0 to 11, shown if a preference is on), section display and private annotations are in
  the personal layer already. The musician type exists, with the first-use setup asking two things:
  lyrics only, and whether to show a capo control. A device default for the instrument offset is open as
  a pull request (#191) and will be reworked into what this document now says.
- Any writer can make an annotation "Everyone" on any setlist they can open (`canShareAnnotations`); this
  would narrow to the people who control the setlist.
- Shared annotations, the delete rule (a writer deletes a setlist they lead, an admin any) and the
  Worker's check of it, the 409 on a stale write, and the default space are built.

## Implementation plan

What is kept, and where (all on the device; the types are presets over the switches, so the switches are
the truth):

| What | Kept as | Notes |
|---|---|---|
| Start with lyrics only | `section_defaults` (as now) | the switch; `setMusicianType` sets it today |
| Capo and tuning controls on | `enable_capo` (as now) | the switch; renamed in the UI |
| Instrument pitch controls on | `enable_pitch` (new) | the switch |
| The type | `musician_type`: `singer`, `guitarist`, `transposing`, `general` (shown as Other), `custom` | `drummer` is read as `singer`; changing a switch by hand makes it `custom` (or the preset it now matches) |
| Tuning, device default | `tuning` (semitones the shapes go up: 0, 1, 2) | |
| Tuning, this setlist | `setlist/local-state.ts`: `tuning`, null for the device's | |
| Capo, a song | as now: per setlist, per song | added to the tuning |
| Pitch, device default | `pitch` (`concert`, `bb`, `eb`, `f`) | stored as the choice; the offset is derived |
| Pitch, this setlist | `local-state.ts`: `pitch`, null for the device's | |
| Pitch, a song | `local-state.ts`: by song, replaces the others | |

For a song the chords move by **tuning (setlist's, else the device's) + pitch offset (song's, else the
setlist's, else the device's) − capo**, each only if its switch is on. The page works this out and
gives the song display one number; a view with no setlist (the library) uses the device defaults. The
chord display is not changed: the number is given to it as the one capo that does the same (`shapesFor`
in the open #191), and Nashville numbers ignore it.

Pull requests, in order, each building on `main` as it is:

1. **"What do you play?"**: the switches, the presets, Custom; the first-use setup and Preferences
   (replacing the lyrics-only radios and the capo toggle); existing settings carried over; no change to
   what is drawn. Header controls show or hide by the switches (the capo already does).
2. **Guitarist**: tuning (Preferences, and the setlist overview's row, editable in edit mode); the
   capo added to it; the header's total ("Capo 2, tuned down: capo 1"). Reworks #191's display change:
   its offset becomes tuning plus pitch resolved per song, and the 12-option list goes.
3. **Transposing instrument**: pitch (Preferences, overview row, a picker in the song's header), the
   display as above; then **the lead sheet's notes**, which need a look at how the melody is
   transposed first.
4. **Who controls a setlist**: the controls for key, tempo, order, removal and "Everyone" annotations
   offered only to them.
5. **Songs added locally.**
6. Remove the read-only reset path.

Tests, as for any preference: the arithmetic in node, each control's setting and its being kept, storage
blocked, the carry-over, and the setlist page following a change.
