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
action-confirm = Confirm
action-cancel = Cancel
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


## Questions before something is changed
## (each has a heading, the message, and the label of the button that does it; Cancel is the other)

confirm-song-reset-heading = Reset Song?
confirm-song-reset-button = Reset

# In the library, which has no capo.
confirm-song-reset-message-library = This will reset the key and all section states back to defaults. This cannot be undone.

confirm-song-reset-message-setlist = This will reset the key, capo, and all section states back to defaults. This cannot be undone.

confirm-song-remove-heading = Remove Song from Setlist?
confirm-song-remove-button = Remove
# { $title } is the song.
confirm-song-remove-message = Are you sure you want to remove "{ $title }" from this setlist?

confirm-setlist-delete-heading = Delete Setlist?
confirm-setlist-delete-button = Delete

# For a setlist that is in Google Drive. { $space } is the space it is in.
confirm-setlist-delete-shared = This deletes the setlist for everyone in { $space }. Its file goes to the Google Drive trash at the next sync, and it can be restored from there.

# For one that never was.
confirm-setlist-delete-local = This deletes the setlist from this device. It was never saved to Google Drive.

confirm-setlist-move-heading = Move Setlist?
confirm-setlist-move-button = Move

# { $title } is the setlist, { $from } the space it is in and { $to } the one it is going to.
confirm-setlist-move-message = Moves { $title } from { $from } to { $to }. The charts it uses are copied, and its leader is added to { $to } if they are not there already. It is removed from { $from }.

# The same for a setlist that is in Google Drive.
confirm-setlist-move-message-drive = Moves { $title } from { $from } to { $to }. The charts it uses are copied, and its leader is added to { $to } if they are not there already. It is removed from { $from }, and its file goes to the Google Drive trash.

confirm-logout-heading = Log out of Google?
confirm-logout-button = Log Out
confirm-logout-message = This signs you out on this device only. Other devices stay signed in. Your songs and setlists stay on this device and in Drive.

confirm-revoke-heading = Revoke access at Google?
confirm-revoke-button = Revoke Access
confirm-revoke-message = This signs you out and revokes Chordless's access to your Google Drive at Google (which needs the network). Every other device signed in with this Google account will need to connect again too. Your songs and setlists stay on this device and in Drive.

confirm-share-stop-heading = Stop sharing?
confirm-share-stop-button = Stop sharing
confirm-share-stop-message = Anyone with the link will lose access, and their copy is removed the next time they open it. You can make a new link later.

confirm-drive-reset-heading = Reset from Google Drive?
confirm-drive-reset-button = Reset
confirm-drive-reset-message = This replaces this device's setlists and songs with the copy in Google Drive. Anything removed from Drive is removed here too. If this device has changes that aren't in Drive yet, nothing is changed.

confirm-drive-start-over-heading = Start over in Google Drive?
confirm-drive-start-over-button = Start over
confirm-drive-start-over-message = Everything on this device is kept, and uploaded again to a new Drive folder. Share links to this space's setlists stop working: make them again. If you can still see the old folder in Drive, it is left alone: delete it by hand when you are sure.

confirm-drive-replace-heading = Replace this device's copy?
confirm-drive-replace-button = Replace
confirm-drive-replace-message = For when another device has already synced this space with this version of the app. This device's setlists and songs are replaced with the folder of this name in Google Drive, and anything only on this device is lost. If there is no such folder, nothing is changed.

confirm-space-switch-heading = Switch?
confirm-space-switch-button = Switch
# { $space } is the space.
confirm-space-switch-message = Switch to "{ $space }"?

confirm-space-delete-heading = Delete from this device?
confirm-space-delete-button = Delete
# The question is these sentences, one after the other, with a space between: this, then the
# next two when they are so, then the last. { $space } is the space.
confirm-space-delete-message = Delete "{ $space }" from this device? Its songs and setlists here are deleted, and anything not yet synced to Google Drive is lost. Its folder in Google Drive is not touched.
# (when it is the space the person is in)
confirm-space-delete-current = It is the one you are in: you will be taken to another.
# (when it is a Team the person is a member of)
confirm-space-delete-team = You stay in the Team: to get it back on this device, ask for a new invite link.
confirm-space-delete-final = This can't be undone.

confirm-team-stop-heading = Stop sharing this Team?
confirm-team-stop-button = Stop sharing
confirm-team-stop-message = Everyone else loses access, and Chordless forgets the sign-in it kept for this Team. The folder and its files stay in your Drive, and on every device that has them.

# { $space } is the Team.
confirm-team-leave-heading = Leave { $space }?
confirm-team-leave-button = Leave
confirm-team-leave-message = You lose access to the Team, and it is removed from this device. The team keeps its songs and setlists, and an admin can invite you again.

# { $email } is the member being removed.
confirm-team-remove-heading = Remove { $email }?
confirm-team-remove-button = Remove
confirm-team-remove-message = They lose access to this Team. What is already on their device stays there, but it no longer syncs.

confirm-move-setlists-heading = Move the setlists?
confirm-move-setlists-button = Move them
# { $count } is how many, and { $source } the space they are in now.
confirm-move-setlists-message =
    { $count ->
        [one] { $count } setlist will move
       *[other] { $count } setlists will move
    } out of { $source } into the team space. They will no longer be in { $source }, only in the team's. Those saved to Google Drive go to its Drive trash, where they can be restored from.

confirm-person-merge-heading = Merge?
confirm-person-merge-button = Merge
# { $person } is the one who goes, { $into } the one who stays.
confirm-person-merge-message = Merge { $person } into { $into }? The setlists { $person } leads are { $into }'s, and { $into } gains their email addresses. { $person } is no longer listed.

confirm-person-delete-heading = Delete?
confirm-person-delete-button = Delete
confirm-person-delete-message = Delete { $person }? They lead no setlists. They are removed from the Leader menu.
`
