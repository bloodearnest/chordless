# CCLI and SongSelect: what the terms mean for Chordless

Summaries, not legal advice; the terms can change without notice. Chordless stores no copyrighted
content (CLAUDE.md, "Spaces and copyright"; docs/SPACES.md, "Principle").

What the SongSelect Terms of Use say that matters here (a summary, not legal advice; the terms can
change without notice):

- **The subscriber is a church, not a person**, and there is no price per user: a church has
  unlimited users, each with their own CCLI Profile linked to the church's account. A chart
  downloaded is a "Digital Fixation", for that church's own non-commercial ministry. It may be used
  by its "staff or volunteers" only; the service is "exclusive to your church" and "confidential".
- **Charts do not move between churches.** The Church Copyright Licence covers the *words* of a
  song for any church; a SongSelect chart (chords, lead sheet) is the subscribing church's. A
  chart in one church's space is not covered by another church's licence by having a CCLI number.
- **200 songs a year.** The Advanced and Premium tiers let a church print or download the charts
  of 200 songs per annual term (counted from the purchase date); more costs extra. The
  bookmarklet's downloads count, as do any made on SongSelect directly, so Chordless can only
  know a lower bound.
- **No passwords to outsiders.** The bookmarklet runs in the person's own signed-in tab. A
  SongSelect login, cookie or token must never reach the Worker or any server of ours.
- The terms say nothing about bookmarklets or automation, but the endpoints it calls are not
  documented and may change.
- The service lasts only while the church's licence does; Chordless cannot see that.

What Chordless does about it: each space can hold its church's **CCLI licence number**, for
records. It is never checked and never a gate: a team made before anyone has the number to hand
must work, as must a church outside the countries CCLI serves.

- **Where it is kept.** A Team's number is kept **by the Worker, in D1**, on the team's row
  (`teams.ccli_licence`), with who set, changed or cleared it, and when, in `team_events`
  (`LicenceChange`). It is the team's record, not a user's: CCLI may ask who a licence is used by,
  and a record of the teams using Chordless is wanted for compliance and perhaps for charging. It
  is not song content, so it is within what the Worker may hold (CLAUDE.md). The device keeps a
  copy to show (`Space.ccliLicence`). A personal space's number is kept on the device alone.
- **Who sets it.** Anyone who can write sets it where there is none; changing or clearing it takes
  an admin (the owner included), who also sees the log. A reader sees the number only.
  `GET`/`PUT /api/space/<id>/licence`; it can also be given when the space is made.
- **How it gets there.** A chart downloaded from SongSelect carries it (the `{ccli_license}`
  directive or the trailer's "CCLI License # N"), so **the first SongSelect import into a space
  with none sets it**, silently (`licenceOfChart`, `noteLicence`). For a Team the Worker is asked
  on the first SongSelect chart of each import: a number already there is copied to the device and
  never written over; one kept only on the device (the Worker was out of reach) is sent. It can be
  typed when a team is made, and changed in the Team's "Users" window (`team-licence-panel.ts`).

Who imported a song, when and from where is already kept on it (`importUser`, `importDate`,
`importSource`). Planned, not built: the licence a song came in under; asking before a copy of
a SongSelect chart goes to a space with a different licence number (a confirmation, not a block);
and a count of the songs imported this term against 200.

## Lead sheets

What CCLI's agreements say about keeping and transposing a lead sheet. This is a reading of the
text, not legal advice. It is of the CCLI Master Terms of Agreement, US
(`store.ccli.com/download/CCLI_terms_of_agreement_us`, linked from `us.ccli.com/terms`) and UK
(`.../CCLI_terms_of_agreement_en`, linked from `uk.ccli.com/terms`), read on 2026-11-05 and 06. It
holds the Church Copyright License, which SongSelect's terms (§6.10) are subject to, and the
SongSelect Terms of Use, updated 2026-10-30. **The UK agreement is the US one with British spelling:**
compared clause by clause, the only differences are that the UK text lacks the definition of
"Territory" (§2.16 in the US text, still used in the UK one), has no US phone number, and adds a
paragraph that third-party licences sold through CCLI (the CLA and PRS/PPL ones, below) are on
those parties' own terms. Section numbers below are the same in both, and so are §3, §10.5, §12
and the SongSelect TOU. Both still say Oregon law and courts. The ccli.com website terms of use (the
same for the UK and US sites, Washington law) say nothing about scripts, scraping or automated
access. Two UK licences sit beside it and do not change the above: the CLA Church Licence (copying
from books, journals and periodicals; it does not mention music, hymns or lyrics) and the PRS/PPL
TheMusicLicence (playing and performing music at premises, with the right to copy reserved,
clause 1.2). The second is who covers performance in the UK, so playing audio in a service is
a PRS/PPL question and not a CCLI one, which the practice-only rule below stays clear of.
`songselect.ccli.com`'s own terms are the SongSelect TOU in the Master Terms.

- **Keeping a faithful copy for the church's own use is what the Church Copyright License lists.**
  §3.1.4 allows copying songs "into and from computerized storage and retrieval software", and the
  SongSelect Service is "online access to and download of Digital Fixations", a Lead Sheet being one.
  Reading the downloaded sheet into notes and storing it in the user's Drive is a copy of that
  sheet in another encoding, as the ChordPro is for the chord sheet.
- **Transposing is a copy in another key, not an arrangement.** SongSelect itself offers the key
  (the bookmarklet already passes the one picked on the page; `GetSongLeadPreview` takes
  `transposeKey`). The TOU lists "modify" among what is not allowed (§6.3), but a subscriber's key
  change is the Service's own function, and it is deterministic: nothing is added.
- **The notes stay read-only apart from the key.** Editing the lead sheet would be an arrangement, and
  §3.1.2 allows those only "to the extent no published version is available" and only if the rights
  in the arrangement stay with the owner. A published lead sheet is what we read, so that clause
  does not cover it. The same goes for **notation made up from the MIDI alone** (no notation
  source), which is a new engraving of the lead sheet and not a copy: do not use the MIDI as the source
  of the notes, only as a check on them and as the pitch for playing.
- **The notice travels with it (§10.5, and TOU §6.9, "will not remove or obscure any notice or
  legend").** On reproducing a song the church is to include the title, writers and copyright
  notice, "Used by Permission. CCLI License #…". It is not limited to projection, and a copy in
  computerized storage is a Copy (§2.8). The lead sheet's own page header and footer carry all of it
  (title, writers, `CCLI Song #`, the copyright, "For use solely with the SongSelect® Terms of Use",
  and the church's `CCLI License #`), and the chart keeps the same as `{ccli}`, `{ccli_license}`,
  `{copyright}` and `{footer}`. A `Score` view or export must show the notice from those, in every
  key. The song info already shows them; they should be at the foot of the lead sheet too.
- **Only the licensed church.** §3.1.7 allows copies for people in the congregation, §3.2.2 no
  distribution outside services and activities, §12 no sublicensing, and the TOU (§6.3, §6.6, §6.7)
  keeps the Service to the church's staff and volunteers. So a team space is for one church's
  team (asking for a CCLI licence when a team is made is an attestation, which is as far as the app
  can go), a team that spans churches is not, and the lead sheet is in no share link (already so, above).
  §10.4 asks for all copies to be destroyed if the licence lapses; the app cannot, and the help can
  say so.
- **Playing it is for practice and rehearsal, never in a service.** §3.2.3 leaves performing out of
  the licence, and CCLI sells a separate Rehearsal License for sharing recordings with the worship
  team to learn from. A MIDI is not a Master Recording, so that is not the same thing, but the
  intent is the same, and the help should say "practice, not for use in a service".
- **Downloads are what is counted.** A song costs one download either way; reading it once and
  transposing here is fewer than one per key. The two ways of getting the notes differ here: the
  PDF download is counted and checked against the subscription's tier like any other. The preview
  call may not be, and may be shown to a tier that has no lead sheets (the TOU's §6.4 speaks of
  subscriptions that "grant the right to print Lead Sheet, Chord Sheet and/or Hymn Sheet"). Until
  that is known, the preview is for what the person could download, and is not stored or sent
  anywhere: it is a check on the PDF's reading, or an equivalent source, not a way round the count.
- **Not decided here:** whether a preview call is counted; whether a missing tier is shown the
  preview (an account on a chord-sheet-only tier would tell). Neither agreement says anything about
  scripts calling SongSelect's own endpoints, for or against. CCLI can be asked in writing, and a
  yes would settle all of it.
