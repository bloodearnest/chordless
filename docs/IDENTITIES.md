# IDENTITIES

> **Status: design (2026-10-29), nothing built yet.** Replaces a setlist's `owner` (a name) and
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

1 and 2 are used silently. 3 and "no match" are shown in the import's review step as **Leader: Tom S.
→ [Tom Smith ▾ | New person]**. Choosing an existing person offers to add the email to them ("add
tom@church.org to Tom Smith"), so the next import matches by 1.

## Migration (database version 10, once per space)

For each setlist: group by `ownerId` when it has one, else by case-insensitive trimmed `owner`; create
a person per group (the most common spelling is the name, the emails are emails), set `leaderId`, delete `owner` and `ownerId`. A name-only group whose name matches an email
group's name joins it. Saved with a new `modifiedDate` so it syncs. The person records are
created with a uuid derived from the group's key, so two devices that migrate separately agree.

Because there is one user for now, no compatibility with older clients is kept: a setlist file with
`owner` and no `leaderId` is read as the old form, through the same grouping, and written back in the
new one.

## People page

A list in Account and Teams (docs/ACCOUNT.md): each person with their emails and how many
setlists they lead; rename, add or remove an email, **Merge into…** (sets `mergedInto`,
rewrites `leaderId` on their setlists, moves the emails across), and Delete (only for a
person who leads nothing). This is also where today's bad names get cleaned up.

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
2. `resolveLeader` in the email import and its review control.
3. The People page (rename, emails, merge).
4. Team link: people from the Worker's members, roles shown.

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
