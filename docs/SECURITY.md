# Security notes

Things to handle, not yet handled. The space model is in SPACES.md.

The team service and the live channel take a Chordless access token as proof of who is asking (SPACES.md,
"Sign-in model"), signed by the Worker with `SESSION_SIGNING_KEY`.

## Key rotation (to do)

Not designed or checked against the code yet. What is known from the design (2026-10-20):

| Key | Where it lives | Effect of rotating |
|---|---|---|
| Blob key (`JWE_ENCRYPTION_KEY`) | Worker secret | The one with consequences, see below |
| Session signing key (`SESSION_SIGNING_KEY`) | Worker secret | Every access token stops working at once (15 minutes of life at most): pages renew them with their refresh tokens, which are in D1 and are unaffected, so nobody signs in again. Change it with a deploy; no overlap is needed. Set it before the deploy that first needs it |
| Refresh tokens | D1 `sessions`, hashed (sha256) | Never readable from the database. A stolen one is good until it is used by its owner (reuse revokes the session) or the session is revoked; a leak of the table gives nothing to present |
| Emailed codes and links | D1 `login_codes`: keyed hashes for checking, and the address and code in the clear for up to 3 days (so the link page can show the code) | Six digits are guessable, so a code has five tries, and five go to an address an hour; the link's id is 128 random bits. The row is deleted when used, replaced, or on the next request after three days. Accepted: the address is held for as long as there is a membership or invite anyway |
| Service account key | Worker secret | Invisible to members: mint a new key, deploy it, delete the old one. Nothing stored to migrate (access tokens are minted in memory) |

**The blob key.** Blobs carry a `kid`, so the Worker can hold old and new keys together, decrypt by
`kid` and encrypt new blobs with the new key (whether `blob.ts` supports several keys is unchecked).
Blobs live in users' IndexedDB (`auth`) and, for an owner-token team space, in that space's
`team_credentials` row in D1. If the old key is dropped before they are re-encrypted, every user gets "sign in again" and
sync stops for every team whose owner's blob is in D1, until that owner reconnects.
So the order is:

1. Add the new key beside the old one.
2. Re-wrap the blobs in `team_credentials` under it (on next use, or by a sweep: now one query).
3. Retire the old key once nothing uses it.

The stored blob must therefore be re-wrappable: design for that when building the
team service.

**A compromised key is different.** The key plus a stolen blob gives a refresh token, so overlap is
not safe. Rotate hard, revoke the owners' grants at Google, and make everyone sign in again.

To decide when this is done: how a rotation is triggered, how the sweep of `team_credentials` runs, and
a test that a blob made under the old key still opens during the overlap and not after it.

## Probing for team spaces (to do)

A team space's id is the key of its rows in D1, so a request for any id reads a row that is not there:
it makes nothing and costs a query. Anyone signed in could still ask for random ids. Done when the route
was wired (2026-10-21): the ID token is verified before the database is touched, a stranger and an
unknown space get the same 403, and an id that is not 8 to 64 letters, digits, `-` or `_` is a 404 with
no query made. Still to do: unguessable ids and per-account rate limits. The one route that is not behind a sign-in,
`POST /api/spaces/invite` (what an invite is for, asked by the page before sign-in), makes no query for an id
or a code of the wrong shape (codes are 128 random bits), answers every bad code alike, and is limited per sender
address (`INVITE_LOOKUP`, `wrangler.toml`). (While the state was in
Durable Objects, a read of an unknown id made a persisted empty object; that is gone with them.) The
original list:

- Verify the ID token **before** touching the database, so only signed-in accounts can.
- Answer a stranger and an unknown space the same (403), so the answer does not say which ids exist.
- Make ids unguessable (random, 128 bits). Option: sign the id with a Worker secret
  (`<random>.<mac>`), so the Worker can reject a forged id without a query.
- Rate-limit by account (as the email handler does with `[[ratelimits]]`).
