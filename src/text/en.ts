/**
 * What the app says to people, in English: a Fluent file (https://projectfluent.org/fluent/guide/)
 * held in a template literal, so that every tool, test and bundler loads it as the module it is.
 * Edit it by hand, or in the running app in dev with Alt + right click on a message. How to write
 * the messages, and how they are used: docs/COPY.md.
 *
 * Only Fluent is in the literal: it must have no backtick and no `${` in it (the editor says so).
 */
export default String.raw`
## Actions: the buttons on a message

action-undo = Undo
action-try-again = Try again
action-reconnect = Reconnect
action-reload = Reload
action-check-for-updates = Check for updates
action-open-account = Open Account and Teams


## Setlists

# A setlist could not be deleted.
toast-setlist-delete-failed = Couldn't delete the setlist.

# A setlist was deleted; the message offers Undo. { $title } is its name.
toast-setlist-deleted = Deleted { $title }.

# Moving a setlist to another space found one with the same name already there.
# { $title } is the setlist, { $space } the space it was to go to.
toast-setlist-move-exists = { $title } is already in { $space }, so it was left here.

toast-setlist-move-failed = Couldn't move the setlist.

# { $title } is the setlist, { $space } the space it went to.
toast-setlist-moved = Moved { $title } to { $space }.

# A change to the setlist's name, date or notes could not be saved.
toast-setlist-details-failed = Couldn't save the setlist details. They are as they were.

# A setlist was changed by someone else (a sync brought their change in), and what changed was not
# anything that can be listed. { $title } is the setlist.
toast-setlist-updated = { $title } was updated

# The same, with what changed in { $changes } (a list: "added Amazing Grace, moved Holy").
toast-setlist-updated-with = { $title } was updated: { $changes }

toast-setlist-restore-failed = Couldn't bring the setlist back.

# A deleted setlist was brought back by Undo. { $title } is its name.
toast-setlist-restored = Brought back { $title }.

toast-setlist-song-add-failed = Couldn't add the song to the setlist.
toast-setlist-song-remove-failed = Couldn't remove the song from the setlist.

toast-setlist-create-failed = Couldn't create the setlist.


## Songs

toast-range-save-failed = Couldn't save the melody range.

toast-annotation-save-failed = Couldn't save the annotation. It is as it was.

# An annotation was deleted; the message offers Undo.
toast-annotation-deleted = Annotation deleted

toast-version-rename-failed = Couldn't rename the version.
toast-version-merge-failed = Couldn't merge the songs.
toast-version-default-failed = Couldn't make it the default.
toast-version-delete-failed = Couldn't delete the version.
toast-song-delete-failed = Couldn't delete the song.


## People and teams

# What went wrong when changing a person in a team's list of people.
toast-people-rename-failed = Couldn't rename them.
toast-people-name-self-failed = Couldn't change your name.
toast-people-add-address-failed = Couldn't add the address.
toast-people-remove-address-failed = Couldn't remove the address.
toast-people-merge-failed = Couldn't merge them.
toast-people-delete-failed = Couldn't delete them.

# The person was found to be in a team this device did not have; it was added. { $name } is the team.
toast-teams-added-one = Added the team { $name }, which you are in.

# The same for several: { $count } of them, with their names in { $names }.
toast-teams-added-many = Added { $count } teams you are in: { $names }.

# A space's songs and setlists could not be fetched. { $space } is its name.
toast-space-fetch-failed = Couldn't get { $space }'s songs and setlists.


## Google sign-in and Drive

toast-signin-expired = Your Google sign-in has expired, so your changes are not syncing.

# Behind "Details" on the message above, when this device has never synced.
toast-signin-expired-details = Reconnect with Google to carry on. Changes made here are kept on this device and will be sent then.

# The same, when it has; { $when } is the date and time of the last sync.
toast-signin-expired-details-last = Reconnect with Google to carry on. Changes made here are kept on this device and will be sent then. Last synced { $when }.

toast-reconnect-failed = Couldn't reconnect with Google.

# Said after the sentence for what happened to the folder, in each of the messages below.
-folder-gone-safe = Your songs and setlists are safe on this device.

# The folder a space is linked to in Google Drive is in the Drive trash. { $name } is the folder's name.
folder-gone-trashed = This space's Google Drive folder "{ $name }" is in the Drive trash. { -folder-gone-safe } Restore it from the trash, or start over in Drive to upload them to a new folder.

# It was linked by an older version of the app, which Drive no longer lets see it.
folder-gone-other-app = This space was synced by an earlier version of Chordless's Google app, which cannot see its Drive folder. { -folder-gone-safe } Start over in Drive to upload them again.

# Drive cannot find it: it was deleted, or the person is signed in with another Google account.
folder-gone-missing = This space's Google Drive folder can't be found: it was deleted, or belongs to another Google account than the one you are signed in with. { -folder-gone-safe } Sign in with the right account, or start over in Drive to upload them again.


## The data on this device

toast-db-too-old = The data on this device is from an old version of Chordless.
toast-db-too-old-details = It is too old to be upgraded here, and has been left as it is. Sign in with Google to bring your songs and setlists back from Drive.

toast-db-restoring = Chordless is bringing your songs and setlists back from Drive.

toast-db-too-new = This device has newer Chordless data than this version can read.

# { $version } is the number of the version of the data's format that this app reads.
toast-db-too-new-details = The data is newer than version { $version } of its format. Check for a newer version of the app.

toast-db-updated-elsewhere = Chordless was updated in another window. Reload this one to carry on.

# Another window of the app has the data open, and so the update here cannot finish.
toast-db-other-windows = Close the other Chordless windows to finish updating.
`
