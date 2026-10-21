# Security notes

Things to handle, not yet handled. The space model is in SPACES.md.

## Key rotation (to do)

Not designed or checked against the code yet. What is known from the design (2026-10-20):

| Key | Where it lives | Effect of rotating |
|---|---|---|
| Blob key (`JWE_ENCRYPTION_KEY`) | Worker secret | The one with consequences, see below |
| Session signing key (proposed, for the team service's session token) | Worker secret | Cheap: tokens last about an hour, so a hard swap costs each client one 401 and `/session/refresh` re-issues it from the blob. A `kid` and a short overlap make it seamless |
| Service account key | Worker secret | Invisible to members: mint a new key, deploy it, delete the old one. Nothing stored to migrate (access tokens are minted in memory) |

**The blob key.** Blobs carry a `kid`, so the Worker can hold old and new keys together, decrypt by
`kid` and encrypt new blobs with the new key (whether `blob.ts` supports several keys is unchecked).
Blobs live in users' IndexedDB (`auth`) and, for an owner-token team space, in that space's Durable
Object. If the old key is dropped before they are re-encrypted, every user gets "sign in again" and
sync stops for every team whose owner's blob is in a Durable Object, until that owner reconnects.
So the order is:

1. Add the new key beside the old one.
2. Re-wrap the Durable Objects' blobs under it (on next use, or by a sweep).
3. Retire the old key once nothing uses it.

The Durable Object's stored blob must therefore be re-wrappable: design for that when building the
team service.

**A compromised key is different.** The key plus a stolen blob gives a refresh token, so overlap is
not safe. Rotate hard, revoke the owners' grants at Google, and make everyone sign in again.

To decide when this is done: how a rotation is triggered, how the sweep of Durable Objects runs, and
a test that a blob made under the old key still opens during the overlap and not after it.
