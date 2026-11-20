# Beta and Stable releases

**Status: agreed design, not implemented.** Stable app releases go out on Monday mornings, after
Sunday services. Changes that pass CI still ship continuously to Beta. A release makes an update
available. It does not reload an open setlist.

This design assumes [central storage](CENTRAL_STORAGE.md) is in place. D1 holds setlists, people, the
song index, preferences and personal overlays, with local copies for offline use. The index carries
the song IDs used in setlists. Personal song files and lead sheets stay on the device, with optional
Google Drive sync. A file or a newer revision that has not reached Drive may exist only on that device.

## Choose a release channel

The **Release channel** setting lives in About and applies to the current browser or installed copy
of the app. It is a device setting, outside the account preferences that sync through D1.

| Choice | Behavior |
| --- | --- |
| **Stable** (default) | Receive weekly releases. Choosing Stable while running Beta requests a return at the next compatible Stable release. |
| **Beta** | Receive continuous releases, including tested local database migrations. |
| **Beta until next Stable** | Join or stay on Beta, then return at the next compatible Stable promotion after making the choice. Once the return completes, the setting becomes Stable. |

About shows the running release and any pending return. A missed Monday or an incompatible release
leaves the return pending. After an explicit request to leave Beta, skip ordinary Beta updates that
would raise the local schema again. A repair release can still raise it if needed. The temporary
Beta choice follows Beta normally while it waits for the next compatible Stable promotion.

If the promoted build is already running, complete the return without reloading. Otherwise prepare
the Stable build in the background and offer the usual update action once it is ready. Coordinate
across open windows so that an update in one window does not interrupt another setlist.

## Serve both channels on one origin

Use one production Worker API on `chordless.app`, with separate Stable and Beta pointers for the
client bundles. Sign-in, sync, D1 and live rooms are shared. Worker deployments affect both channels,
so a change to shared behavior must work with supported Stable clients even before Monday. Use a
server-side feature gate when a change needs a Beta trial before wider rollout.

Publish immutable bundles under `/releases/<build-id>/` in R2. The bucket holds public build artifacts
and release notes. Each bundle contains its shell, service worker and build-specific assets, including
deferred files and lazy imports. Verify the whole bundle before making it available through a channel
pointer. Serve immutable URLs with long cache lifetimes and return a 404 for missing assets. Keep
active builds and retain superseded builds for at least 90 days initially. This asset retention period
is separate from the API support window. Explicit build URLs keep the shell and assets together across
deployments. See [Cloudflare's version skew guidance](https://developers.cloudflare.com/workers/versions-and-deployments/version-skew/).

Use a device cookie to select the channel for the shell and `/service-worker.js`. Serve those selectors
with `Cache-Control: no-store`. Keep the desired channel and pending return in local settings, and check
the target build's local database compatibility before opening a space even if the cookie was lost.
The installed app keeps its identity, root service worker registration, deep links and share targets.

The service worker precaches the full update before offering it. A failed download leaves the current
app usable. Keep prior release caches while open tabs need them, and preserve the existing pad and
incoming share caches. See [Build](BUILD.md) for the current offline lifecycle.

## Local migrations and Reset to Stable

**Beta can migrate local databases backed by D1 ahead of Stable.** Once a migration has shipped to
Beta, keep a tested forward path from that schema for the supported upgrade window. For example,
Beta can upgrade from v15 to v16 while Stable remains on v15. A later Stable release can open v16
or upgrade it to v17. An IndexedDB open at a lower version fails, so a bad migration is fixed with
a forward repair shipped immediately to Beta. Test that repair on devices that took the bad build and
on devices that skipped it. Copy data first when a later repair may need the original.

**Personal song files have their own store.** Both channels must be able to read and write it, preserve
song IDs and round-trip fields they do not understand. Prefer compatible changes that leave the IndexedDB
version alone. If a version bump is necessary, ship a Stable reader that can handle it before Beta
upgrades the store. Test with songs absent from Google Drive and local revisions newer than Drive's.

**Reset to Stable** is a separate emergency action, available even if Beta cannot open a space. It
requires a connection. Fetch and verify the Stable build, check that it can read the song store, and
rebuild the D1-backed state in fresh local databases. Switch only after the checks and rebuild succeed.
Leave the song store in place. Retain the old Beta databases for recovery with their sync disabled, so
pending offline edits can be recovered deliberately without replaying them into D1. Tell the user if
those edits will be missing from the fresh copy. A failed check or rebuild leaves the existing data
intact and offers a retry. If Beta already synced bad changes to D1, disable the faulty write path
and repair the affected server records separately.

## Worker API support

Keep an old API contract working for at least **30 days after the first Stable promotion that supports
its replacement**. A Beta release does not start the clock. The current Stable client always remains
supported. Record the qualifying promotion, the earliest retirement date and the planned API minimum.
Retire on the first eligible Monday or later if the rollout needs more time.

1. Add the replacement alongside the old contract. Preserve reads, writes, revision checks, conflict
   handling and tombstones across both versions, including edits queued by an offline client.
2. For a breaking D1 change, add the new tables or columns before deploying code that needs them.
   Backfill and maintain both representations while supported code needs both. Remove the old one
   in a later migration after supported APIs and Worker versions no longer depend on it.
3. Promote the replacement client to Stable. Test a supported older client against the live contract
   before retirement, including reconnecting with edits queued under the old version.
4. Once eligible, raise the API minimum and retire the old contract. The Worker rejects retired
   requests with `CLIENT_UPDATE_REQUIRED` before any write. CI checks the recorded Stable promotion
   date before allowing the minimum to advance.

Each build declares its API version. On online startup, the app checks a small uncached compatibility
endpoint before opening a space or starting sync. An unsupported build shows **Update required** with
working update and recovery controls. If the floor rises while a setlist is already open, leave the
setlist on screen, pause sync and preserve queued edits. Offline startup can use the cached app until
it learns that its version is retired. Remember a confirmed retirement so going offline after that does
not bypass the startup block. Offer a compatible Beta repair or Reset to Stable if the available
Stable build cannot open the device's current schema. Ship these controls to Stable before the first
API retirement.

## Build, promote and publish the changelog

- **Beta:** Keep CI and the existing infrastructure gates on `main`, including the scheduled catch-up
  for merges that do not trigger a push workflow. Build and publish the candidate, verify compatibility
  with supported clients, and smoke-test it before moving the Beta pointer. Compatible Worker changes
  continue to deploy through Wrangler.
- **Stable:** On Monday at **08:30 Europe/London**, select the latest eligible candidate that passed CI
  and Beta smoke tests by the cutoff. Verify it against the live API and promote the same artifact.
  Leave Stable in place if no newer candidate qualifies. Serialize pointer changes and record the
  source commit, artifact hash, schema compatibility, smoke result and promotion time. Alert on missed
  promotions and provide a manual path for urgent forward fixes. The schedule is a target because
  [GitHub Actions scheduled runs can be delayed or dropped](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows#scheduled-workflows-are-delayed).
- **Release notes:** The [PR template](../.github/pull_request_template.md) asks authors to add a short
  entry in Git under **New**, **Improved** or **Fixed**, or mark that the PR has no user-facing change.
  The author writes the text once and the build pipeline assembles it. Generate each channel's notes
  from its last successful promotion to the candidate, including all the changes that made it through
  Beta into Stable. Omit changes reverted before promotion. A skipped Monday leaves the starting point
  unchanged. Publish notes separately from the bundle and attach them to the promotion record before
  moving the pointer. If notes fail to generate or publish, leave the channel on its current release.
- **What’s new:** Show the running release's notes in About and offer a preview for an update that is
  ready. Keep the running notes available offline. A return from Beta on the same build should still
  show the Stable summary. Release notes use the existing update flow and add no notifications.

## Implementation order and checks

1. Add the release mechanism and compatibility controls with both channel pointers on the same build.
   Verify that existing installations upgrade and relaunch offline. Add the changelog entries, PR
   prompt and promotion checks before enabling independent channel releases.
2. Put the durable agent rules in `CLAUDE.md` (`AGENTS.md` points to it). Update [Migrations](MIGRATIONS.md)
   with the expand, migrate and retire procedure and [CI](CI.md) with the release steps. Add a PR
   compatibility section for changes to the API, D1 or IndexedDB. Ask which released clients were
   tested, how the change rolls out and, for retirement, which Stable promotion started the clock.
3. Test against the deployed Stable client and older API versions still in their support window. Cover
   queued edits on reconnect, direct Stable upgrades, intermediate Beta schemas, forward repairs and a
   reset that preserves an unsynced song and its ID. Test the API floor with a device that skips the
   whole window, including access to recovery when it cannot open a space.
4. Verify all three choices in Chromium and WebKit and on an installed iOS app. Include a skipped Monday,
   same-build promotion, several Beta releases in one Stable changelog, a reverted change, failed
   precaching, multiple open windows and offline relaunch. Check that a Beta publish leaves the Stable
   shell and service worker unchanged. Run `just format lint test` and `just ci` before rollout.
5. Enable the channel choices after the update and reset paths pass. Track update failures, missing
   assets, database open failures and sync errors by channel and build. Keep the ordinary release
   cadence separate from urgent repairs.
