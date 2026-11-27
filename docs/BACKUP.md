# Backing up what Chordless holds

What the server keeps (the D1 database, and the R2 bucket of song charts, source PDFs and pads) is not in Google Drive
any more once a space has moved (docs/CENTRAL_STORAGE.md), so Drive is no longer a second copy. R2 has no versioning, so an
object that is deleted or overwritten is gone; D1 keeps 30 days of point-in-time history of its own (Time Travel), which
protects the database and nothing in the bucket.

## `just backup`

```
just backup        # the bucket: CLOUDFLARE_API_TOKEN or the file .cloudflare-token (R2 read); the database: `wrangler login`, or a token with D1
```

It makes, under `.backups/server/` (git-ignored, readable by its owner alone: it holds people's addresses and charts):

- `<time>/database.sql`: the whole database (`wrangler d1 export --remote`), one per run;
- `<time>/manifest.json`: the bucket's objects as they were listed (key, etag, size), one per run;
- `r2/<key>`: every object in the bucket, by its key, saved once. An object that is there already and the same (etag and size) is
  not fetched again, so a second run is quick. One that **changed** since (a pad that was replaced) is kept beside as
  `<key>.replaced-<old etag>` and the new one saved. **Nothing is ever deleted from the copy**, including an object the bucket
  no longer lists: it may have been deleted by mistake, which is what a backup is for.

It only reads on the server. It ends by checking the copy is whole: each object is the size the bucket said, and every song
chart the database refers to (`library_songs.bundle_ref`) is in the bucket. It prints what it found, and exits with an error if
anything is missing.

A backup on the computer that runs it is a backup against the server losing things, not against the computer: copy `.backups/`
somewhere else now and then (an external disk, another machine). Run it before any change that deletes or rewrites data
(the one-off cutover, step 8), before deleting a space's Google Drive files, and now and then.

## Restoring

**The database** (into an emptied database; the file is SQL):

```
npx wrangler d1 execute chordless-teams --remote --file .backups/server/<time>/database.sql
```

(or, to look first, into a local one: `--local --file …`). Within 30 days of a mistake, D1's own Time Travel restores a point in
time without this file: `npx wrangler d1 time-travel restore chordless-teams --timestamp <time>`.

**The bucket**, an object at a time, or all of them:

```
cd .backups/server/r2 && find library -type f ! -name '*.replaced-*' | while read -r key; do
  npx wrangler r2 object put "chordless-songs/$key" --remote --file "$key"
done
```

(`wrangler r2 object put` sets no content type: put `--content-type application/json` for `*.json` and `audio/mpeg` for `*.mp3`.)

## Not yet

- A copy somewhere that nothing on this computer or in the Cloudflare account can reach (a scheduled job to another provider,
  with a key that can add but not delete). That is what protects against a compromise, and is the next step of the TODO
  "backup and recovery process for centrally stored data".
- A check that a backup has been made lately.
