# IDENTITIES

> **Status (2026-10-29): step 1 is built (people store, upgrade to version 10, `leaderId`, people synced as a `people` collection: docs/SYNC_ARCHITECTURE.md, "People"). Step 2 is built (matching in the email import, and which person is "me"). Step 3 is built (the page that lists, merges and deletes them). Step 4 is not.** Replaces a setlist's `owner` (a name) and
> `ownerId` (an email) with a link to a person in the space's own list of people.

## Why

A leader is a free-text name on each setlist, and the email is a second copy of who they are. So
the same person can be "Tom", "Tom S." and "tom smith" (the email import takes the name as the
email wrote it), a person with two addresses is two people, and a leader known only by name can
never be linked to anything. Team spaces know their members and roles (the Worker's Durable
Object); a personal space knows nobody.

## The person

A space has a list of **people**: a `people` object store in its IndexedDB, synced with the space
like setlists (one record each).

```
Person {
  id: string            // uuid, never changes
  name: string          // as shown
  emails: string[]      // lower-cased; a person may have several
  teamMember?: string   // "provider:sub" (identityKey, docs/SPACES.md), only in a team space
  deleted?: boolean     // set when deleted: the record stays, so another device's copy does not bring them back
  mergedInto?: string   // set when merged into another person; the record stays so that a
                        // device that has not synced yet can still resolve the id
  modifiedDate: string
}
```

A person's names are not copyrighted content, so they may live in the space and in Drive. Roles are
**not** stored on a person: in a team space the role is read from the Durable Object by
`teamMember`, which keeps the Worker as the one place that decides who may do what.

## Setlists

`owner` and `ownerId` go. A setlist has `leaderId` (a person's id, or none). Every place that showed
`owner` looks the person up:

| Where | Today | After |
|---|---|---|
| Setlist form's Leader menu | the space's members + you | the space's people; "Other…" makes a person |
| Home list, setlist header, song history ("last played") | `setlist.owner` | the person's name |
| Song list text (copy/email) | `setlist.owner` | the person's name |
| Drive file name (`setlistFilename`) | `owner` slug | the person's name at the time of writing |
| Share bundle | `owner` | the leader's name (`leader: {name}`): the receiver has no people list |
| Received share | `owner` | a person made in the receiving space? No: it keeps the name only, shown, never linked |

A setlist whose `leaderId` finds no person (not yet synced) shows no leader rather than failing.

## Matching (the email import, and anything else that has a name or email)

`resolveLeader({name, email})`, in order:

1. an email equal to one of a person's `emails`;
2. a name equal (ignoring case, accents, punctuation, extra spaces) to a person's `name`;
3. a fuzzy candidate: the same words in another order, a unique first name, or initials ("Tom S.").

1 is used silently. 2, 3 and "no match" are shown in the import's review step, above the setlist's
details, as a note and a menu: "The email's leader, “Tom S.”, might be one of your people. Who is it?"
[Tom Smith ▾ | A new person: Tom S. | …]. The best candidate is chosen; choosing a person adds the
email to them when the setlist is made ("tom@church.org is added to them, so the next email from it
is matched by its address"), and a new person is stored then too. (Built: `suggestPeople` and
`resolveLeader` in `leaders.ts`, `_renderLeaderMatch` in `setlist-email-import.ts`.) A candidate is a
person whose name has each typed word as a whole word or its start, in any order, ranked whole words
first; a person the typed name is exactly is a match, not a suggestion.

## Which person is me

The person using the app is worked out per space and device (`getSpacePeople`, `me`), in order:

1. the person **chosen on this device** (`chordless:me:<space id>` in local storage: it differs by
   device, so it is not synced). Choosing adds the signed-in account's address to that person, so any
   device finds them by it from then on;
2. the person with the **signed-in account's address**;
3. a person of the **same name who has no address yet** (who gains it), else a **new person** made
   from the account.

Where the account's name is that of a person who has other addresses it is not guessed, and the
form asks "Which of these is you?" (the people, "Not sure yet", "None of these: add me"): an answer
is `identifyMe`. The Leader menu marks the person "(you)", and a new setlist is led by them.

## Migration (database version 10, once per space)

For each setlist: group by `ownerId` when it has one, else by case-insensitive trimmed `owner`; create
a person per group (the most common spelling is the name, the emails are emails), set `leaderId`, delete `owner` and `ownerId`. A name-only group whose name matches an email
group's name joins it. Saved with a new `modifiedDate` so it syncs. The person records are
created with a uuid derived from the group's key, so two devices that migrate separately agree.

Because there is one user for now, no compatibility with older clients is kept: a setlist file with
`owner` and no `leaderId` is read as the old form, through the same grouping, and written back in the
new one.

## People page

**Built.** On the Account and Teams page (docs/ACCOUNT.md) every space's card has a **Leaders** button
(the page says "Leaders", not "People": a Team's *Users* are its members and their roles, a different
list) that opens `space-people.ts` in a modal, for any space on the device, not only the one in use.
Each person has:

- their **name**, to rename (an empty name puts the old one back);
- their **email addresses**, each with an ×, and a field to add one. An address that is not one, or
  is another person's ("Ann has that address already: merge them to join the two"), is refused with
  the browser's own validation message; addresses are lower-cased;
- how many setlists they **lead**, and "you" for the person using the app;
- **Merge into…** and **Delete**, each after a question. A merge gives the other person the addresses
  (and the team link, if they had none), repoints the setlists (`leaderId`), and marks the person
  `mergedInto`, as do the people merged into them earlier. A delete is only for a person who leads
  nothing and is not you, and marks the person `deleted`: the record stays, or another device's copy
  would bring them back (a pull never deletes). A deleted person is not listed, found, suggested or
  named; a person who is a member of a Team, or the one signed in, is made again by the next
  `getSpacePeople`, so deleting them does nothing lasting.

This is where the bad name an earlier import made is cleaned up: merge it into the right person. In a
Team only worship leaders (`writer` and above) change anything; a team member sees the list. (A team
member's own name waits for the Worker route in step 4.) Failures are toasts, and the page shows the
people as they are.

## Team spaces

- The member list the Worker returns (provider:sub, email, name, role) becomes people: matched by
  email to an existing person, which gains `teamMember`; otherwise a new person.
- Roles shown beside a person come from the member list. A person without `teamMember` is a leader
  who has no Chordless account, which is fine: no role, can still lead.
- Inviting from a setlist's leaders (`team-invite-step.ts`) uses a person's emails (the first, or a
  choice if there are several), not `ownerId`.

## One person in several teams

Each space has its own list of people, because spaces are self-contained (docs/SPACES.md). The same
human in two teams, or in a team and your personal space, is **one person record in each**, with no
link between the spaces except what identifies them: the same `teamMember` (`provider:sub`) and the
same emails. Consequences:

- Names and emails may differ per space (a nickname in one team); nothing reconciles them.
- Their role is per team, read from each team's Durable Object by that space's `teamMember`.
- "Me" in a space is the person whose `teamMember` is mine, else whose email is mine.
- Copying or moving a setlist to another space remaps `leaderId` there: by `teamMember`, then email,
  then name, else a new person is made. The id is never carried across.
- Shares carry the name only (above), so nothing links across spaces that way either.

## Steps

1. The store, the migration, `leaderId`, and every display and file-name use of `owner`; the form's
   menu from the store.
2. `resolveLeader` in the email import and its review control (built), and which person is me (built).
3. The People page (rename, emails, merge).
4. Team link: people from the Worker's members, roles shown, and "me" matched by `teamMember` before the address.

## Who may edit people

Decided 2026-10-29.

- **Personal space:** you, of course.
- **Team space:** worship leaders (the `writer` role) and above may add, rename, merge and delete
  people, and edit their emails. A team member (`reader`) may edit only **their own
  name** (the person whose `teamMember` is theirs).
- The Worker already refuses writes to the space's files from a team member, so their own-name edit
  needs a route of its own: it accepts a change to the one person record whose `teamMember` is the
  caller's, and only its `name`. Until that route exists a team member's edit stays on their device
  (read-only only stops writing back to sync, never local edits: CLAUDE.md); a later sync may
  replace it with the name the space has, which is acceptable until then.

## Decided

- People are synced with the space, one record each (not a single file, which would conflict
  whenever two devices add someone).

## Open

- The Worker route for a team member's own name (step 4).
