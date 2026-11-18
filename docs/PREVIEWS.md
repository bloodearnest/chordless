# Trying a branch away from the computer

`just branch-preview <branch>` serves a branch's dev server on the tailnet, so a pull request can be tried on
a phone or tablet, signed in, with a Team and its songs already there. It runs on the developer's
machine (which must be on): a Cloudflare preview was considered and rejected, below.

## Use

```bash
just branch-preview claude/some-topic   # serve it (stops the one before)
just branch-preview-status
just branch-preview-stop
```

It finds the branch's worktree (or makes `.claude/worktrees/preview-<branch>` from `origin/<branch>`),
runs `npm ci` if needed, applies the branch's migrations to the local database, starts `npm run dev` on
port 8787 and runs `tailscale serve` at `https://<machine>.<tailnet>.ts.net`. Tailnet only: not `funnel`.

## One origin, one database

Every preview is the same address, so the browser's IndexedDB, localStorage and service worker carry
over from one branch to the next: settings and charts stay. Going back to an older branch after one
that raised `DB_VERSION` can fail; clear the site's data.

The register of teams' local database (accounts, the test Team) is `.preview/state`, one copy that every
previewed worktree's `.wrangler/state` links to, so it also carries over. `.dev.vars` is linked from the
primary checkout. `.preview/` is git-ignored.

## Setting up (once)

1. `sudo tailscale set --operator=$USER`, so `tailscale serve` needs no sudo; HTTPS enabled for the
   tailnet in the Tailscale admin console.
2. The machine's `https://<machine>.<tailnet>.ts.net` as an authorized JavaScript origin of the dev OAuth
   client and an allowed referrer of the dev Picker key (`docs/ENVIRONMENTS.md`; Terraform cannot).
3. The test account and Team: sign in on the preview with a dedicated test Google account and make a Team
   whose folder is in its dev Drive, or seed from a dev database that has one (`just branch-preview-snapshot`).
   The owner's token is encrypted with the Worker's key, so it cannot be written as SQL.
4. Songs: keep an export (Account and Teams, "Export and import") as `test-export.zip` at the top of the
   primary checkout; it is git-ignored, and updating it is all it takes. The preview's dev server hands it
   to the page (`vite-plugins/preview-seed.ts`), and a Personal space with no songs imports it at
   start-up (`src/js/preview-seed.ts`), so clearing the site's data brings the songs back. Nothing else
   is touched: not a Team, and not a space that already has songs. It is dev-server only (a build has no
   such route or code), and the file stays on this disk. A Team's songs come from its Drive folder.

Google sign-in is needed each time a browser's data is cleared; the emailed code is not (it only prints to
the terminal in dev).

## Why not Cloudflare

Previews are off on purpose (`wrangler.toml`: `workers_dev`, `preview_urls`). `wrangler versions upload`
would share production's D1 and secrets and applies no migrations, and Durable Object migrations are not
allowed in it; a Worker per PR needs its own D1, Durable Objects and secrets; and Google sign-in needs the
origin listed (no wildcards), so per-PR addresses cannot sign in.
