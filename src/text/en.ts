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

# { $space } is the space.

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


## What a page says while it loads, when it has nothing to show, and when it could not

status-loading = Loading…
status-checking = Checking…

## Joining a team with an invite link (src/components/team-join.ts)

# The heading once the invite is known. { $team } is the team's name, { $role } the role with its article
# ("a team member", "a worship leader", "an admin").
join-welcome-heading = You are invited to join { $team } as { $role }.

# The same, when the invite could not be looked up (the device is offline, or too many tries).
join-welcome-unknown = You have been invited to join a team on Chordless.

# Above the sign-in button when the invite was sent to a Gmail or Google Workspace address, which is then the
# account to use. { $email } is that address.
join-sign-in-invited = Sign in with the Google account { $email }. Chordless asks only who you are: it gets no access to your Google Drive.

# For an invite that makes someone an admin: it only works with the address it was sent to. { $email } is that address.
join-admin-exact = This invite makes you an admin, so it can only be used with the address it was sent to: { $email }. Sign in with the Google account that has that address.

# Above the sign-in button on an Android phone, which has a Google account on it. { $email } is the address the invite was sent to.
join-sign-in-android = Sign in with the Google account on this phone. It does not have to be { $email }. Chordless asks only who you are: it gets no access to your Google Drive.

# Above the sign-in button for someone who has said they have a Google account. { $email } is the address the invite was sent to.
join-sign-in-any = Sign in with the Google account you use. It does not have to be { $email }. Chordless asks only who you are: it gets no access to your Google Drive.

# The same, when the address the invite was sent to is not known.
join-sign-in-any-nameless = Sign in with the Google account you use. Chordless asks only who you are: it gets no access to your Google Drive.

join-sign-in-button = Sign in with Google

# The question for someone who may not have a Google account, on a device that does not say.
join-has-google-question = Do you already have a Google account? It can be a Gmail address, or any other address that someone has made a Google account with.
join-has-google-yes = Yes, sign in
join-has-google-no = No, I need one

join-make-heading = Make a Google account
join-make-easiest = The easiest way is a new Gmail address. It takes a few minutes, and you can use it with Chordless straight away.
join-make-open-signup = Make a Gmail address
# { $email } is the address the invite was sent to.
join-make-existing = Or make a Google account with the address you already have, { $email }. This is fiddlier: Google offers a new Gmail address first, and the link to use your own is small.
join-make-guide-link = Show me how, step by step
join-make-done = I have made one: sign in
join-make-back = Back

## Inviting people

# Under an invite just made: whether Chordless emailed it. { $email } is who it is for.
invite-emailed = We have emailed the invite to { $email }. The link is here too, in case you want to send it another way.
invite-not-emailed = The invite could not be emailed, so send the link to { $email } yourself. It is shown once.

## A Team's list of people

membership-heading = Your place in the Team
membership-owner = You are the owner of this Team.
membership-member = You are { $role } in this Team.
membership-stop = Stop sharing
membership-leave = Leave this Team

people-heading = People ({ $count })
people-heading-personal = People who lead setlists ({ $count })
people-none-personal = Nobody leads a setlist here yet.
people-hint-personal = Edit changes a person's name and addresses. Two spellings of one person are put right by merging one into the other.
people-hint-read-personal = This space is view only, so the people cannot be changed.
people-search = Search people
people-none = Nobody matches.
people-column-name = Name
people-column-email = Email
people-column-role = Role
people-column-status = Status
people-column-actions = Actions
people-edit = Edit
people-edit-aria = Edit { $name }
people-you = you
people-leads = leads { $count }
people-status-member = Member
people-status-visitor = Not a member
people-status-invited = Invited · { $days } days left · not emailed
people-status-invited-emailed = Invited · { $days } days left · emailed { $emailed }
people-today = today
people-yesterday = yesterday
people-days-ago = { $days } days ago
people-resend = Send again
people-resend-heading = Send the invite to { $email } again?
people-resend-message = This makes a new invite and emails it. The link in the earlier email stops working.
people-resend-button = Send again
people-resent = The invite was emailed to { $email } again.
people-resend-not-emailed = The invite to { $email } could not be emailed, so its new link is copied: send it yourself.
people-copy-link = Copy the link
people-link-copied = The link is copied.
people-revoke = Revoke
people-invite = Invite someone
people-invite-email = Their email address
people-invite-role = Their role
people-invite-make = Invite
people-invite-hint = Chordless emails them a link that works once, for a week. They can sign in with any Google account, or with a code emailed to them.
people-invite-link = Invite link
people-invite-them = Invite them to the Team
people-team-role = Role in the Team
people-role-aria = Role of { $name }
people-remove = Remove from the Team
people-known-as = The Team knows them as { $emails }.
people-no-name-yet = They have no name here yet.
people-name-them = Give them a name
people-hint-edit = Edit changes a person's name and addresses, and a member's role. A role acts only on those below it.
people-hint-read = You can see who is in the Team, and change your own name.

## Signing in with an emailed code

# The other way to sign in, for someone with no Google account: Chordless emails a code to their address.
email-code-button = Use my email address instead
email-code-heading = Sign in with your email address
email-code-address-label = Your email address
email-code-send = Email me a sign-in link
email-code-sending = Sending…
email-code-sent = We have emailed { $email } a link and a 6-digit code. Open the link on this device, or enter the code here. It can take a minute, and it may be in your spam folder.
email-code-label = The 6-digit code
email-code-submit = Sign in
email-code-checking = Checking…
email-code-resend = Send it again
email-code-have = I already have a code
email-code-enter = Enter the 6-digit code for { $email }.
email-code-other-address = Use a different address
email-code-error-address = That does not look like an email address.
email-code-error-too-often = Too many tries. Wait a minute and try again.
email-code-error-send = The code could not be sent. Try again in a moment.
email-code-error-wrong = That code is not right. Check it and try again.
email-code-error-expired = That code has run out, or was used. Ask for a new one.
email-code-error-too-many = Too many wrong codes. Ask for a new one.
email-link-working = Signing you in…
email-link-choose = Where do you want to be signed in? If you use Chordless as an app from your Home Screen, it keeps its own sign-in, apart from this browser's, so use the code in the app instead.
email-link-here = Sign in in this browser
email-link-app = I use the installed app: show me the code
email-link-code-intro = Enter this code in Chordless to sign in as { $email }.
email-link-copied = The code is copied.
email-link-copy-by-hand = Copy the code by hand.
email-link-code-steps = Open Chordless from your Home Screen, go back to where you were signing in, choose "Use my email address instead" and then "I already have a code", and enter your address and this code. It works once, so do not also sign in in this browser.
email-link-failed = That link has been used or has run out. Ask for a new one.
email-link-none = To sign in, enter your email address and we will email you a link and a code.
email-code-error-failed = Signing in did not work. Try again in a moment.

# For a page opened inside another app's own browser. { $app } is the app's name.
join-in-app-heading = Open this page in your browser
join-in-app-body = You are looking at this inside { $app }, whose built-in browser often stops Google sign-in from working. Open this page in Chrome or Safari instead.
join-copy-link = Copy link
join-link-copied = Link copied
join-continue-here = Continue here anyway

# Before joining with an account that is not the address the invite was sent to. { $invited } and { $email } are addresses.
join-as-other = This invite was sent to { $invited }, and you are signed in as { $email }. You can join with this account. It will be the one the team knows you by, and { $invited } is noted as yours too.

join-not-valid = This invite is not valid. It may have been used, withdrawn or have run out: ask the person who sent it for a new one.

status-setlists-loading = Loading setlists...
status-setlists-failed = Error loading setlists. Please check the console.
status-setlist-loading = Loading setlist...
status-setlist-info-loading = Loading setlist information...
status-setlist-info-none = No setlist information available.

status-songs-loading = Loading songs...
status-songs-failed = Error loading songs. Please check the console.
status-songs-none = No songs to display.
status-songs-no-match = No songs match your search.
status-song-load-failed = Couldn't load this song
status-song-info-loading = Loading song information...
status-song-info-none = No song data available.
status-song-card-none = No song data

# The library page, with nothing in it.
status-library-empty = No songs in library.
status-library-empty-detail = Import setlists to populate the song library.
# The same in the list of songs to add to a setlist.
status-library-empty-modal = No songs in library
status-library-empty-modal-detail = Import songs from the menu to fill the song library.

# A space (a Team, say) whose songs and setlists are coming from Drive. { $space } is its name.
status-space-getting = Getting { $space }'s songs and setlists…
# What a screen reader says of the progress bar under it.
status-space-getting-label = Getting { $space }'s songs and setlists
status-space-not-fetched = { $space }'s songs and setlists have not been fetched yet.
status-space-not-fetched-detail = They come from Google Drive. You need to be online and signed in.
status-space-no-setlists = { $space } has no setlists yet.
status-space-no-setlists-detail = Create the first with the + at the top.
action-get-them-now = Get them now
action-getting-them = Getting them…

space-sync-sign-in-hint = Sign in on the Account and Teams page to sync.


## Signing in

action-sign-in = Sign in with Google
account-email-only-status = Signed in with your email address. Google is not connected, so your own spaces will not sync.
account-connect-google = Connect Google
account-email-signed-in = Signed in with your email address.
account-signed-out-name = Not signed in
account-signed-out-text = Your songs and setlists stay on this device. Signing in with Google lets you sync them, share setlists, and join a team.


## Lead sheets, and the pads that play under a song

# The button over a song that switches between its words and its lead sheet. The first is the label
# when the song has no lead sheet.
leadsheet-none = No lead sheet for this song
leadsheet-show-lyrics = Show the lyrics
leadsheet-show = Show the lead sheet

pad-error-load = Could not load pad sound for this key
pad-error-none = No pad set yet: upload one in Storage


## About

about-update-none-label = No updates here
about-update-none-detail = This browser isn't keeping the app's files, so every visit loads the latest.


## Who someone is in a Team (these are also in sentences: "as a worship leader")

role-owner = owner
role-admin = admin
# The role the Worker calls a writer, who may change the songs and setlists.
role-writer = worship leader
# The role the Worker calls a reader, who may only read.
role-reader = team member
role-owner-with-article = an owner
role-admin-with-article = an admin
role-writer-with-article = a worship leader
role-reader-with-article = a team member


## What a space is called (the page says Personal and Team, never "space")

space-kind-team = Team
space-kind-personal = Personal
space-role-view-only = View only
space-default = Default
space-current = Current
# { $licence } is the CCLI licence number of the Team.
space-ccli = CCLI licence { $licence }

# What a space holds: { $songs } songs, { $setlists } setlists and { $size } (a size, "1.2 MB").
space-summary =
    { $songs ->
        [one] { $songs } song
       *[other] { $songs } songs
    } · { $setlists ->
        [one] { $setlists } setlist
       *[other] { $setlists } setlists
    } · about { $size }

# When a space last synced. { $when } is how long ago, or the date.
space-synced = Synced { $when }
space-not-synced = Not synced yet
space-sync-starting = Starting…
# { $reason } is what went wrong.
space-sync-failed = Sync failed: { $reason }
space-sync-sign-in = Sign in to sync
space-sync-connect-drive = Connect Google Drive to sync

# How long ago a sync was, for "Synced { $when }" and "Last synced: { $when }". { $count } is the number.
sync-time-now = Just now
sync-time-minutes =
    { $count ->
        [one] { $count } minute ago
       *[other] { $count } minutes ago
    }
sync-time-hours =
    { $count ->
        [one] { $count } hour ago
       *[other] { $count } hours ago
    }
sync-time-days =
    { $count ->
        [one] { $count } day ago
       *[other] { $count } days ago
    }

action-sync = Sync
action-manage = Manage
action-make-default = Make default
action-reconnect-google = Reconnect with Google

# A page for a space that is not on this device (an old link, say).
space-missing = This device has no such Personal space or Team. It may have been deleted.

# On the page of one space: the panel for what it syncs with, and its parts.
space-copy-team-heading = Team copy
space-copy-drive-heading = Google Drive
space-copy-team-text = Replace this device's songs and setlists with the Team's copy. Sync is on the space's card.
space-copy-drive-text = Replace this device's songs and setlists with the copy in Google Drive. Sync is on the space's card.
# <connect> is a link to the Account and Teams page.
space-drive-not-connected = You are signed in, but Google Drive is not connected, so this space is not syncing. <connect>Connect Google Drive</connect> on the Account and Teams page.

space-export-heading = Export and import
space-export-text = Export this space's songs and setlists as a zip file, and import an export into it, on this device or another: it needs no Google account, and an import only adds what is missing.
space-export-text-team = Export this Team's songs and setlists as a zip file, and import an export into it, on this device or another: it needs no Google account, and an import only adds what is missing.

space-delete-heading = Delete from this device
space-delete-text = Remove this space and its songs and setlists from this device. Its folder in Google Drive stays.
space-delete-text-team = Remove this Team and its songs and setlists from this device. Its folder in Google Drive stays.
space-delete-button = Delete…
space-delete-failed = Failed to delete it: { $reason }

space-delete-everywhere-heading = Delete everywhere
# <em> is the word that is stressed.
space-delete-everywhere-text = Delete this space from this device <em>and</em> from Google Drive, whose trash keeps its folder for thirty days. It asks for a backup first.
space-delete-everywhere-text-team = Delete this Team from this device <em>and</em> from Google Drive, whose trash keeps its folder for thirty days. It asks for a backup first.


## The Account and Teams page

account-heading = Account
account-spaces-heading = Personal and Team Spaces
account-join-hint = To join a Team, open the invite link its admin sent you.
account-create-team = Create a new Team
account-teams-look = Look for my teams
account-teams-looking = Looking…
account-teams-look-hint = Teams you are in on another device are added by themselves; this looks now, and brings back any you took off this device.
# { $names } is the Teams that were put on this device, a list.
account-teams-added = Added { $names }.
account-teams-all-here = Every team you are in is on this device.
account-teams-look-failed = Could not look for your teams: { $reason }
account-device-heading = This device

account-manage = Manage
account-advanced = Advanced
account-logout = Log out
account-revoke = Revoke access on all devices
account-test-refresh = Test token refresh
account-backup-download = Download sign-in backup
account-backup-import = Import sign-in backup
account-connect-drive = Connect Google Drive
# The name of someone whose Google account gave none.
account-name-unknown = Signed in
account-status-expired = Sign-in expired: reconnect to sync
account-status-no-drive = Signed in, Google Drive not connected
account-status-connected = Google Drive connected

# What the card says after something was done. { $reason } is what went wrong.
account-signed-in = Signed in.
account-signed-in-no-drive = Signed in. Google Drive was not connected, so your own spaces will not sync yet.
account-signin-failed = Signing in failed: { $reason }
account-drive-connected = Google Drive connected.
account-drive-not-connected = Google Drive was not connected.
account-drive-connect-failed = Connecting Google Drive failed: { $reason }
account-logged-out = Logged out on this device.
account-logout-failed = Logging out failed: { $reason }
account-revoked = Logged out, and Chordless's access to your Drive was revoked.
account-revoked-unreached = Logged out on this device, but Google could not be reached to revoke Chordless's access. You can remove it at myaccount.google.com/permissions
account-revoke-failed = Revoking access failed: { $reason }
account-backup-download-failed = Downloading the backup failed: { $reason }
account-backup-imported = Sign-in backup imported.
account-backup-import-failed = Importing the backup failed: { $reason }
account-refresh-not-signed-in = Not signed in: sign in with Google first.
# { $old } and { $new } are the times the token was due to expire before and after.
account-refresh-works = Token refresh works: expiry { $old } → { $new }
account-refresh-failed = Token refresh failed: { $reason }

storage-heading = Storage Usage
storage-browser-data = Browser data
storage-app-cache = App Cache
storage-media-cache = Media Cache
storage-unreadable = Unable to read local storage details.
storage-footnote = Data on this device only. Each team's size is on its own card.


## Syncing a space with Google Drive (the panel on a space's page)

drive-sync-unavailable = ⚠️ Drive Sync Unavailable
# <connect> is a link to the Account and Teams page.
drive-sync-unavailable-text = You need to <connect>connect with Google Drive</connect> to enable sync.
drive-sync-reset = ⤓ Reset from Google Drive
drive-sync-start-over = ↻ Start over in Drive
drive-sync-replace = ⤓ Replace with the copy in Drive
drive-sync-last = Last synced: { $when }
drive-sync-folder-missing = Drive folder not found
drive-sync-ready = Ready
drive-sync-failed-status = Failed
drive-sync-progress-label = Sync progress
drive-sync-starting-reset = Starting reset...
drive-sync-starting-over = Starting over in Drive...
drive-sync-replacing = Replacing from Drive...
drive-sync-failed = Failed: { $reason }


## Preferences

pref-appearance-heading = Appearance
pref-behaviour-heading = Behaviour and options
pref-accessibility-heading = Accessibility

pref-play-heading = What do you play?
pref-play-text = What each song shows when you open it, and which controls you get. Only you see it.
pref-lyrics-only = Start each song with only the lyrics
pref-show-capo = Show the capo and tuning controls
pref-show-pitch = Show the instrument pitch controls
pref-my-instrument = My instrument
pref-pitch-text = Each setlist, and each song, can have its own: choose it there, in edit mode.
pref-my-tuning = My guitar is tuned
pref-tuning-text = Each setlist can have its own tuning: choose it on the setlist, in edit mode.

# The choices of "What do you play?" (and the first-use setup): the choice and a line under it.
play-singer = I sing, or play drums
play-singer-description = Lyrics only to start, with no chord controls
play-guitarist = I play guitar
play-guitarist-description = Chords and lyrics, with capo and tuning controls
play-transposing = I play a B♭, E♭ or F instrument
play-transposing-description = Chords and lyrics, with an instrument pitch control
play-general = Another instrument
play-general-description = Chords and lyrics, as they are written
play-custom = Custom
play-custom-description = Choose each setting yourself

# The instrument pitches. The first word of each (B♭, E♭, F) is also what the header shows.
pitch-concert = Concert pitch
pitch-bb = B♭ (trumpet, clarinet, tenor sax)
pitch-eb = E♭ (alto or baritone sax)
pitch-f = F (horn)

tuning-standard = Standard
tuning-half-step = Half step down
tuning-whole-step = Whole step down

pref-chords-heading = Chords
pref-nashville = Nashville numbers instead of letter names
pref-unicode = Unicode accidentals (♯/♭)
pref-leadsheets-heading = Lead sheets
pref-real-book = Real Book style: handwritten notation and chords (-7, ø7, °)
pref-moving-heading = Moving between songs
pref-scroll-top = Start each song at its top (off: find it where you left it)

pref-screen-heading = Screen and live mode
pref-screen-text = Keep the screen on while a setlist is open, and on any page while you are live (Go live is on a setlist's overview).
pref-keep-awake = Keep the screen awake
pref-battery-limit = On battery, let go after no touch for
pref-no-limit = No limit

# A limit in words, in a sentence ("no touch for { $limit }"). { $count } is the number.
pref-limit-none = no limit
pref-limit-minutes =
    { $count ->
        [one] { $count } minute
       *[other] { $count } minutes
    }
pref-limit-hours =
    { $count ->
        [one] { $count } hour
       *[other] { $count } hours
    }

# What keeping the screen awake is doing: a word, and why.
wake-refused = Refused
# { $reason } is what the device said.
wake-refused-detail = The device refused it ({ $reason }). Battery Saver can cause this.
wake-unsupported = Unsupported
wake-unsupported-detail = This browser can't keep the screen awake.
wake-off = Off
wake-off-detail = The screen may turn off while you play.
wake-awake = Awake
wake-awake-detail = The screen is being kept awake.
wake-awake-live = The screen is being kept awake, on any page, while you are live.
# { $limit } is the time limit on battery ("15 minutes").
wake-awake-limit = The screen is being kept awake, until there is no touch for { $limit }.
wake-awake-live-limit = The screen is being kept awake, on any page, while you are live, until there is no touch for { $limit }.
wake-released = Let go
wake-released-detail = The device let go (another app, the screen off, or a low battery). It is taken again when you come back.
wake-expired = Timed out
wake-expired-detail = Let go after { $limit } with no touch, to spare the battery. Touch the screen to keep it awake again.
wake-ready = Ready
wake-ready-detail = The screen is kept awake while a setlist is open, and on any page while you are live.
wake-power-mains = On mains power: there is no time limit.
wake-power-battery = On battery: the time limit applies.
wake-power-unknown = This device can't say whether it is on mains power, so the time limit always applies.
wake-ask-again = Ask again


## About (the version, updates, offline use, install and storage)

about-version-heading = Version
about-version-unknown = Version unknown
# { $version } is the build's id.
about-version = Version { $version }
# { $date } is the day it was released ("12 October 2026").
about-version-released = Version { $version }, released { $date }
about-reload-now = Reload now

about-update-ready = Update ready
about-update-ready-detail = A new version is saved on this device. Reload to use it.
about-update-getting = Getting the update
about-update-getting-detail = A new version is being saved on this device.
about-update-checking = Checking
about-update-checking-detail = Looking for a new version.
about-update-failed = Couldn't check
about-update-failed-detail = The server couldn't be reached. Are you offline? It tries again from time to time.
about-update-current = Up to date
# { $ago } is when ("just now", "5 minutes ago").
about-update-checked = Checked { $ago }.
about-update-current-detail = It checks when you open the app, and now and then while it is open.

# How long ago, in the middle of a sentence. { $count } is the number.
ago-now = just now
ago-minutes =
    { $count ->
        [one] { $count } minute ago
       *[other] { $count } minutes ago
    }
ago-hours =
    { $count ->
        [one] { $count } hour ago
       *[other] { $count } hours ago
    }

about-offline-heading = Offline
about-offline-none = Not offline
about-offline-none-detail = This browser can't save the app for offline use.
about-offline-ready = Ready offline
about-offline-ready-detail = The whole app is saved on this device, so it opens without a connection.
about-offline-not-yet = Not yet
about-offline-not-yet-detail = Reload the app once, so it can save itself for offline use.

about-install-heading = Install
about-install-button = Install Chordless
about-install-done = Installed
about-install-done-detail = Running as an installed app.
about-install-not = Not installed
about-install-not-detail = Install it to open full screen and keep its data safe.
# For an iPhone or iPad.
about-install-ios-detail = Tap the Share button, then Add to Home Screen. The installed app keeps its own data, so you will sign in again in it.
about-install-mac-detail = In the menu bar, choose File, then Add to Dock.
about-install-cannot = Can't install here
about-install-cannot-detail = This browser has no way to install the app.

about-storage-heading = Storage on this device
about-storage-protect = Ask the browser to keep it
about-storage-protected = Protected
about-storage-protected-detail = The browser will not clear this app's songs and setlists to make room.
about-storage-not-protected = Not protected
about-storage-not-protected-detail = The browser may clear this app's data if the device runs short of room. Installing the app helps.
# Added after either of the two above, with a space between. { $size } is what the app uses ("3.2 MB").
about-storage-using = Using { $size }.
about-storage-unknown = Unknown
about-storage-unknown-detail = This browser can't say whether it will keep this app's data.


## The menu

menu-label = Navigation menu
menu-update-ready = Update ready: reload
menu-overview = Overview
menu-setlists = Setlists
menu-library = Song Library
# { $title } is the name of the page the Help is for ("Setlist Overview").
menu-help = Help: { $title }
menu-preferences = Preferences
menu-account = Account and Teams
menu-media-player = Media Player
menu-import = Import Songs
menu-about = About


## Highlight colours, fonts, theme and text size (Preferences > Accessibility and Appearance)

tint-heading = Chord highlight
tint-text = A coloured background behind the chords, not the words: some readers with dyslexia or visual stress find it easier. Pick whichever suits you.
tint-group-label = Chord highlight colour
tint-none = None
tint-none-label = No highlight
# { $colour } is one of the colours below.
tint-preset-label = { $colour } highlight
tint-own = Your own
tint-own-label = Your own highlight colour
# { $ratio } is the contrast of the chords against the highlight ("7.2").
tint-contrast = Chords read at { $ratio }:1 contrast
tint-yellow = Yellow
tint-cream = Cream
tint-peach = Peach
tint-pink = Pink
tint-green = Green
tint-blue = Blue

font-heading = Fonts
font-text = A typeface for each part, from the fonts your device has. Saved on this device only.
# { $area } is the part: App, Lyrics or Chords.
font-picker-label = { $area } font
font-area-ui = App
font-area-ui-description = menus, buttons and settings
font-area-lyrics = Lyrics
font-area-lyrics-description = the words of the song
font-area-chords = Chords
font-area-chords-description = the chord names above the words
font-default = Default
font-default-note = the app's own
font-clear = Clear sans
font-clear-note = wide, open letters (Verdana, Tahoma)
font-friendly = Friendly
font-friendly-note = rounded, easy to tell apart (Comic Sans)
font-humanist = Humanist sans
font-humanist-note = softer shapes (Calibri, Gill Sans)
font-serif = Serif
font-serif-note = with feet (Georgia)
font-mono = Monospace
font-mono-note = every letter the same width

theme-heading = Theme
theme-system = System
theme-system-label = Use system preference
theme-system-title = Follow your system's theme preference automatically
theme-light = Light
theme-light-label = Light theme
theme-dark = Dark
theme-dark-label = Dark theme
# { $current } is the theme the system has now ("light" or "dark").
theme-following = ✓ Following system preference (currently { $current })

scale-heading = Font size
scale-text = All text in the app, lyrics included. Saved on this device only.
scale-slider-label = Font scale slider
scale-small = Small 80%
scale-normal = Normal 100%
scale-large = Large 125%
scale-largest = Largest 150%


## The media player's settings

mps-heading = 🎵 Media Player Settings
mps-player = Enable Media Player
mps-player-text = Master control for all media player features
mps-metronome = Enable Metronome
mps-metronome-text = Click track with tempo and time signature
mps-stereo = Stereo Split (L/R)
mps-stereo-text = Pads → Left, Click → Right
mps-downbeat = Emphasise downbeat
mps-downbeat-text = Off, every click sounds like an off-beat one
mps-double = Double the click for slow songs
mps-double-text = Two clicks per beat at or below this tempo, unless a song says otherwise
mps-double-below = At or below (BPM)
mps-pads = Enable Pads
mps-pads-text = Background pad audio playback
mps-padset = Pad Sound Set
mps-padset-text = Select which pad audio library to use
mps-padset-none-upload = Chordless has no pads of its own: choose "Upload a new pad set…" to add a set you own
# <media> is a link to the Media Player page.
mps-padset-none = Chordless has no pads of its own: upload a set you own on the <media>Media Player page</media>
mps-padset-choose = Choose a pad set
mps-padset-none-yet = No pad sets yet
mps-padset-upload = Upload a new pad set…
mps-padset-preparing = Preparing pad set…
`
