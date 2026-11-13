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

- **My instrument**: a transposition, in semitones, so the chords shown fit the instrument or the
  tuning: Bb, Eb or F, a guitar tuned a half or a whole step down, or a number of semitones typed in. Not a key
  per song: an Eb horn is Eb for every song. It has two levels:
  - a **default for the device** ("I play alto sax"), and
  - an **override for one setlist**, always possible ("Bb this week", "tuned down for this one"). A setlist
    that has none uses the device's.

  The key shown is the shared key plus the offset. Only offsets are covered: drop D and other tunings
  that change the shapes and not the key are not.
- **Capo**, per song, as now. It changes the shapes shown, not the key.
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

## What goes away, and what changes

- **A writer's change of key or tempo on someone else's setlist** is no longer offered. Today any writer
  can. The person's way to a different key is My instrument.
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
- **Naming.** "My instrument" is the working name; "My key" was considered and is a letter, not an offset.

## Today

What is built and will change:

- A writer's key, tempo, order and removal edit the shared setlist; a reader's stay on the device and
  are replaced when the leader changes the setlist (docs/SPACES.md, "Read-only").
- Capo, section display and private annotations are in the personal layer already.
- Any writer can make an annotation "Everyone" on any setlist they can open (`canShareAnnotations`); this
  would narrow to the people who control the setlist.
- Shared annotations, the delete rule (a writer deletes a setlist they lead, an admin any) and the
  Worker's check of it, the 409 on a stale write, and the default space are built.

## Order of work

1. This document; the other docs point here.
2. **My instrument**: the device default and the setlist override, in the personal layer.
3. **Who controls a setlist**: the controls for key, tempo, order, removal and "Everyone" annotations
   offered only to them.
4. **Songs added locally.**
5. Remove the read-only reset path.
