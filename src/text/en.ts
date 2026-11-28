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
action-reload = Reload
action-check-for-updates = Check for updates
action-open-account = Open Account and Teams


## Setlists

# A setlist could not be deleted.
toast-connect-drive-failed = Couldn't connect Google Drive.
toast-drive-disconnected = Google Drive is disconnected.
toast-drive-disconnected-kept = Google Drive is disconnected from your account. A Team you own is still kept in your Drive, so Google's access for Chordless was left in place.
toast-drive-disconnect-failed = Couldn't disconnect Google Drive.
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
toast-db-too-old-details = It is too old to be upgraded here, and has been left as it is. Sign in, and connect Google Drive, to bring your songs and setlists back from Drive.

toast-db-restoring = Chordless is bringing your songs and setlists back from Drive.

toast-db-too-new = This device has newer Chordless data than this version can read.

# { $version } is the number of the version of the data's format that this app reads.
toast-db-too-new-details = The data is newer than version { $version } of its format. Check for a newer version of the app.

toast-db-updated-elsewhere = Chordless was updated in another window. Reload this one to carry on.

# Another window of the app has the data open, and so the update here cannot finish.
toast-db-other-windows = Close the other Chordless windows to finish updating.


## Help (the page for each page of the app: Menu > Help)

# The text of each page of help is these messages, by page, section and item; the pictures that go
# with them are named in js/help-content.ts. A text may link inside the app: [Preferences](/preferences).


### The setlist overview

help-overview-title = Setlist Overview
help-overview-intro-1 = This is your setlist: the songs for the service, in the order you will play them, each with the key it will be played in.
help-overview-intro-2 = Tap a song to open its lyrics and chords. Once you are playing you will mostly stay on the songs, and come back here when you want to see the whole list.
help-overview-getting-around-heading = Getting around
help-overview-getting-around-tap-a-song-label = Tap a song
help-overview-getting-around-tap-a-song-text = Opens its lyrics and chords.
help-overview-getting-around-swipe-left-or-press-label = Swipe left (or press →)
help-overview-getting-around-swipe-left-or-press-text = Goes to the first song, and on through the setlist from there.
help-overview-getting-around-menu-label = Menu
help-overview-getting-around-menu-text = Jump straight to any song in the setlist, or go to your other setlists, the song library and your [preferences](/preferences).
help-overview-while-you-are-playing-heading = While you are playing
help-overview-while-you-are-playing-go-live-label = Go live
help-overview-while-you-are-playing-go-live-text = Tell the app you are playing from this setlist. The screen stays awake and the app goes full screen, so nothing gets in the way. It turns red while you are live; tap it again when you are done.
help-overview-while-you-are-playing-add-song-label = Add Song
help-overview-while-you-are-playing-add-song-text = A song that was not planned? Find it in your library and it goes on the end of the setlist. This is always available, even when you are live.
help-overview-sharing-and-details-heading = Sharing and details
help-overview-sharing-and-details-share-label = Share
help-overview-sharing-and-details-share-text = Make a link that anyone can open to see this setlist, without needing to sign in.
help-overview-sharing-and-details-information-label = Information
help-overview-sharing-and-details-information-text = The setlist’s name, date and notes.
help-overview-changing-the-setlist-heading = Changing the setlist
help-overview-changing-the-setlist-intro = Moving, removing and re-keying songs are kept behind edit mode, so they cannot happen by accident while you are playing. Tap the pencil to turn it on, and again (or press Esc) to turn it off.
help-overview-changing-the-setlist-edit-label = Edit
help-overview-changing-the-setlist-edit-text = Turns edit mode on and off.
help-overview-changing-the-setlist-a-song-in-edit-mode-label = A song in edit mode
help-overview-changing-the-setlist-a-song-in-edit-mode-text = Each song gets a button to remove it, its tempo and key, and a handle to move it by.
help-overview-changing-the-setlist-reorder-label = Reorder
help-overview-changing-the-setlist-reorder-text = Drag a song by its handle to move it up or down the setlist.
help-overview-changing-the-setlist-key-label = Key
help-overview-changing-the-setlist-key-text = Choose the key a song will be played in, for this setlist.
help-overview-changing-the-setlist-bpm-label = BPM
help-overview-changing-the-setlist-bpm-text = Type the tempo a song will be played at, for this setlist.
help-overview-changing-the-setlist-remove-label = Remove
help-overview-changing-the-setlist-remove-text = Take a song out of the setlist. It asks first, and the song stays in your library.

### A song in a setlist

help-song-title = Setlist Song
help-song-intro-1 = This is one song from your setlist: the lyrics, with the chords above them, in the key you will play it in.
help-song-intro-2 = When you finish it, swipe to the next. You can show or hide the chords on each section of the song, so the page shows just what you need.
help-song-getting-around-heading = Getting around
help-song-getting-around-swipe-left-or-right-or-press-label = Swipe left or right (or press → and ←)
help-song-getting-around-swipe-left-or-right-or-press-text = Goes to the next song, or the one before. Going back from the first song takes you to the overview.
help-song-getting-around-scroll-or-press-and-label = Scroll (or press ↑ and ↓)
help-song-getting-around-scroll-or-press-and-text = A long song carries on below the screen.
help-song-getting-around-menu-label = Menu
help-song-getting-around-menu-text = Jump straight to any song in the setlist, or go to the overview.
help-song-about-this-song-heading = About this song
help-song-about-this-song-key-capo-and-tempo-label = Key, capo and tempo
help-song-about-this-song-key-capo-and-tempo-text = What you are playing at the top of the page: the key, and the capo, tempo and time signature when the song has them.
help-song-about-this-song-information-label = Information
help-song-about-this-song-information-text = More about the song, such as who wrote it.
help-song-about-this-song-player-label = Player
help-song-about-this-song-player-text = Play a pad or a click track in the song’s key, to help the band start together. Stop it, or expand it for its settings. It can be turned off in [Preferences](/preferences).
help-song-edit-mode-heading = Edit mode
help-song-edit-mode-intro = Changes to the song are kept behind edit mode, so they cannot happen by accident while you are playing. Turn it on, and the page gets two sets of controls: one for each section of the song, and one for the song as a whole. They are described next. Turn it off again to play.
help-song-edit-mode-edit-label = Edit
help-song-edit-mode-edit-text = Turns edit mode on and off. The Esc key turns it off too.
help-song-edit-mode-each-section-of-the-heading = Edit mode: each section of the song
help-song-edit-mode-each-section-of-the-intro = Every section of the song (a verse, the chorus, a bridge) gets its own controls, at the top of the section.
help-song-edit-mode-each-section-of-the-show-label = Show
help-song-edit-mode-each-section-of-the-show-text = Choose what that section shows: everything, just the lyrics, just the chords, or nothing at all.
help-song-edit-mode-each-section-of-the-collapse-label = Collapse
help-song-edit-mode-each-section-of-the-collapse-text = Fold the section up to a single line, and open it again.
help-song-edit-mode-the-whole-song-heading = Edit mode: the whole song
help-song-edit-mode-the-whole-song-intro = The key at the top of the page becomes a button. Tap it to open the song’s settings.
help-song-edit-mode-the-whole-song-song-settings-label = Song settings
help-song-edit-mode-the-whole-song-song-settings-text = This is the panel that opens. What is in it is described next.
help-song-edit-mode-the-whole-song-key-label = Key
help-song-edit-mode-the-whole-song-key-text = Choose the key to play in. The song’s own key is marked with a star.
help-song-edit-mode-the-whole-song-capo-label = Capo
help-song-edit-mode-the-whole-song-capo-text = Choose where the capo goes, with the key the chords are played in at each fret. You can change it once you have said you play guitar in [Preferences](/preferences), or turned on the capo there.
help-song-edit-mode-the-whole-song-tempo-bpm-label = Tempo (BPM)
help-song-edit-mode-the-whole-song-tempo-bpm-text = Slow the song down or speed it up, for the click track.
help-song-edit-mode-the-whole-song-pads-label = Pads
help-song-edit-mode-the-whole-song-pads-text = Choose which of your pad sets plays for this song. This is there when the player is on.
help-song-edit-mode-the-whole-song-reset-label = Reset
help-song-edit-mode-the-whole-song-reset-text = Put the song back as it was: its key, capo and which sections are shown. It asks first.
help-song-edit-mode-annotations-heading = Edit mode: annotations
help-song-edit-mode-annotations-intro = Write an annotation on the chart: how to play a part, where to drop out, how many times to repeat. It is set in handwriting, above the word it is on, or beside the name of a section. Annotations are shown when you are not editing too. An annotation belongs to this song in this setlist.
help-song-edit-mode-annotations-press-and-hold-label = Press and hold
help-song-edit-mode-annotations-press-and-hold-text = Press and hold a word, a chord or the name of a section to write an annotation there. (On a computer, right-click does it too.)
help-song-edit-mode-annotations-the-annotation-label = The annotation
help-song-edit-mode-annotations-the-annotation-text = Type the annotation. “Seen by” is just you (the usual), or everyone: an annotation for everyone goes with the setlist, so everyone who has it sees it. Only people who can edit the setlist can share an annotation with everyone.
help-song-edit-mode-annotations-change-or-delete-an-annotation-label = Change or delete an annotation
help-song-edit-mode-annotations-change-or-delete-an-annotation-text = Tap an annotation to change it. Delete takes it off, and you can bring it back with Undo.
help-song-edit-mode-annotations-an-annotation-for-the-whole-song-label = An annotation for the whole song
help-song-edit-mode-annotations-an-annotation-for-the-whole-song-text = Use “+ Annotation on the whole song” above the first section.

### The song library

help-library-title = Song Library
help-library-intro-1 = Every song you can put in a setlist lives here. Search for one, tap it to read it, and use edit mode to set it up the way you like it.
help-library-finding-a-song-heading = Finding a song
help-library-finding-a-song-search-label = Search
help-library-finding-a-song-search-text = Type part of a title, an artist or some of the lyrics. The search is kept in the address, so a link to it works too.
help-library-finding-a-song-tap-a-song-label = Tap a song
help-library-finding-a-song-tap-a-song-text = Opens it, to read its lyrics and chords.
help-library-getting-around-heading = Getting around
help-library-getting-around-swipe-label = Swipe
help-library-getting-around-swipe-text = Swipe left from the list to the song, and right to come back to the list.
help-library-getting-around-scroll-label = Scroll
help-library-getting-around-scroll-text = Move through the list, or down a long song.
help-library-getting-around-menu-label = Menu
help-library-getting-around-menu-text = Your setlists, [preferences](/preferences), importing songs and the rest of the app.
help-library-getting-around-information-label = Information
help-library-getting-around-information-text = More about the song, such as who wrote it.
help-library-edit-mode-heading = Edit mode
help-library-edit-mode-intro = The pencil turns edit mode on, so you can set a song up. What you choose is saved with the song when you turn it off. Turn it on, and you can change the song’s key, and set what each section of it shows.
help-library-edit-mode-edit-label = Edit
help-library-edit-mode-edit-text = Turns edit mode on and off.
help-library-edit-mode-the-key-heading = Edit mode: the key
help-library-edit-mode-the-key-key-label = Key
help-library-edit-mode-the-key-key-text = Change the key the song is shown in.
help-library-edit-mode-each-section-of-the-heading = Edit mode: each section of the song
help-library-edit-mode-each-section-of-the-intro = Every section of the song (a verse, the chorus, a bridge) gets its own controls.
help-library-edit-mode-each-section-of-the-show-label = Show
help-library-edit-mode-each-section-of-the-show-text = Choose what that section shows: everything, just the lyrics, just the chords, or nothing at all.
help-library-edit-mode-each-section-of-the-collapse-label = Collapse
help-library-edit-mode-each-section-of-the-collapse-text = Fold the section up to a single line, and open it again.


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
confirm-logout-message = This signs you out on this device only. Other devices stay signed in. Your songs stay on this device, and in any Team space.


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

# For an invite that makes someone an admin: it only works with the address it was sent to. { $email } is that address.
join-sign-in-intro = Sign in to join. Chordless asks only who you are.
join-admin-exact = This invite makes you an admin, so it can only be used with the address it was sent to: { $email }. Sign in with that address.

# Above the sign-in button on an Android phone, which has a Google account on it. { $email } is the address the invite was sent to.

# Above the sign-in button for someone who has said they have a Google account. { $email } is the address the invite was sent to.

# The same, when the address the invite was sent to is not known.


# The question for someone who may not have a Google account, on a device that does not say.

# { $email } is the address the invite was sent to.

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

people-heading = Members ({ $count })
people-invites-heading = Invites ({ $count })
people-invites-none = No invites are waiting.
people-heading-personal = People who lead setlists ({ $count })
people-none-personal = Nobody leads a setlist here yet.
people-hint-personal = Edit changes a person's name and addresses. Two spellings of one person are put right by merging one into the other.
people-hint-read-personal = This space is view only, so the people cannot be changed.
person-name-heading = Name
person-name-aria = Name
person-emails-heading = Email addresses
# { $name } is a person's name.
person-emails-aria = Email addresses of { $name }
# { $address } is an email address.
person-email-remove-aria = Remove { $address }
# { $name } is a person's name.
person-email-add-aria = Add an email address to { $name }
person-email-add-placeholder = Add an email address
person-email-add = Add
person-merge-heading = Merge into another person
person-merge-hint = In case of duplicate identities, you can merge two together. This will merge their emails and any setlist they own into the same account
# { $name } is a person's name.
person-merge-aria = Merge { $name } into
person-merge-choose = Choose a person…
person-delete-heading = Delete
person-delete = Delete
person-delete-you = This is you.
person-delete-leads = They lead setlists, so they cannot be deleted. Merge them into someone instead.
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
sign-in-or = or
sign-in-google = Continue with Google
sign-in-google-note = Google also turns on syncing your Personal space between your devices, with your Google Drive.
email-code-heading = Sign in
email-code-address-label = Email
email-code-send = Continue
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
email-link-code-steps = Open Chordless from your Home Screen, go back to where you were signing in, choose "I already have a code", and enter your address and this code. It works once, so do not also sign in in this browser.
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

account-signed-out-name = Not signed in
account-signed-out-text =
    Your songs and setlists stay on this device. Signing in lets you access Team data that is shared with you.

    If you sign in with a Google account your personal data is synced between your devices. Otherwise, just team data is.


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
# { $name } is the name of a folder in the person's Google Drive.
adopt-folder-error = There is no Drive folder called "Personal", but there is one called "{ $name }".
adopt-folder-heading = Use the folder you already have?
# { $name } is the name of a folder in the person's Google Drive.
adopt-folder-message = Your Drive has one Chordless folder, "{ $name }", and none called "Personal". Is that where your Personal songs and setlists are kept? If so, Chordless will use it as it is: nothing in it is renamed, moved or deleted.
adopt-folder-use = Use "{ $name }"
adopt-folder-new = Make a new folder
space-sync-sign-in = Sign in to sync
space-drive-off = Google Drive is not connected, so this space does not sync between your devices.
space-drive-reconnect = Google Drive needs reconnecting to sync.
space-drive-on = Google Drive: { $email }
# { $name } is a team that has become part of your church on Chordless: this device sends its songs and setlists to it, and stops using Google Drive for it.
team-adopted = { $name } is now part of your church on Chordless. This device is sending its songs and setlists, and will not use Google Drive for it again.
# Toasts, when your Personal space was moved to Chordless on another device and this device follows it by itself.
space-switching = Your Personal space has moved to Chordless on another device. Switching this device too…
space-switched = This device now uses Chordless for your Personal space, like your other device.
space-switch-failed = Could not switch this device to Chordless. It will try again.
# Toasts, when a Personal space still kept in Google Drive moves to Chordless by itself, as Drive is no longer used to keep spaces.
space-leaving-drive = Your Personal space is moving from Google Drive to Chordless. Keep this page open for a minute…
space-left-drive = Your Personal space is now kept on Chordless. Its Google Drive files are left as they were.
# The card of a Personal space that has been moved to Chordless: where it syncs now.
space-server-on = Stored on Chordless
# The card of a Personal space that has not been moved: the button that starts it, and the question it asks first.
action-move-to-server = Move to Chordless
# { $name } is the name of the space, the heading of the question to confirm moving it.
space-move-heading = Move { $name } to Chordless?
space-move-message = Its songs and setlists will be stored on Chordless, and synced between your devices from then on. It will not sync with Google Drive again, and this cannot be undone. Its files in Google Drive stay where they are until you delete them. Pad audio is not moved: add your pads again when you need them.
# Shown on the card while a space is being moved.
space-move-starting = Moving to Chordless… stay on this page until it is done.
# { $sent } of { $total } songs have been sent to Chordless.
space-move-progress = Moving to Chordless… { $sent } of { $total } songs sent. Stay on this page until it is done.
# The account already has songs or setlists on Chordless: nothing has been moved yet, and this asks whether to combine.
# { $name } is the name of the space.
space-combine-heading = Combine { $name } with your Chordless account?
space-combine-message = Your Chordless account already has songs or setlists. Moving this space will add its songs and setlists to them; nothing already on your account is removed. A song or setlist that is on both, such as one moved from another of your devices, is kept once, and a change made to it on both is settled the way any other change on two devices is. A song that was imported twice may show twice. This cannot be undone.
action-combine-with-server = Combine and move
# The move stopped part way (the connection dropped, or the phone was locked) after the space was marked as on Chordless: nothing is lost, and a sync sends what is left.
space-move-interrupted = The move was interrupted. Nothing is lost: press Sync to finish it, and stay on this page until it is done.
# { $reason } is what went wrong.
space-move-failed = Could not move the space: { $reason }
space-move-failed-plain = Could not move the space.
# On the card of a moved space whose old files are still in Google Drive.
space-drive-left = Its old files are still in Google Drive.
action-delete-drive-files = Delete Google Drive files
# { $name } is the name of the space, the heading of the question to confirm.
space-drive-delete-heading = Delete the Google Drive files of { $name }?
space-drive-delete-message = Its folder in Google Drive, with everything in it (including pad audio and shared setlists), goes to your Drive bin, where it can be recovered for thirty days. The space stays on Chordless.
space-drive-delete-confirm = Delete files
# { $reason } is what went wrong.
space-drive-delete-failed = Could not delete the files: { $reason }
space-drive-delete-failed-plain = Could not delete the files.
action-connect-drive = Connect Google Drive
action-reconnect-drive = Reconnect Google Drive
action-disconnect-drive = Disconnect Google Drive
confirm-drive-disconnect-heading = Disconnect Google Drive?
confirm-drive-disconnect-button = Disconnect
confirm-drive-disconnect-message = Your Personal space stays on your devices and in your Google Drive, and you stay signed in. Syncing stops on all of your devices until you connect Google Drive again.

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
action-manage-users = Manage Users
action-manage-data = Manage Data
# { $name } is the name of a space.
space-data-heading = { $name }: data
action-make-default = Make default

# A page for a space that is not on this device (an old link, say).
space-missing = This device has no such Personal space or Team. It may have been deleted.

# On the page of one space: the panel for what it syncs with, and its parts.
space-copy-team-heading = Team copy
space-copy-drive-heading = Google Drive
space-copy-team-text = Replace this device's songs and setlists with the Team's copy. Sync is on the space's card.
# The Manage Data page of a Personal space that has moved to Chordless, where there is no Google Drive copy to restore from.
space-copy-drive-text = Replace this device's songs and setlists with the copy stored on Google Drive.
# <connect> is a link to the Account and Teams page.
space-drive-not-connected = You are signed in, but Google Drive is not connected, so this space is not syncing. <connect>Connect Google Drive</connect> on the Account and Teams page.

space-export-heading = Export and import
space-export-text = Export this space's songs and setlists as a zip file. This can be used as a backup, or imported into another device if you do not have sync enabled. On import, it will only add what is missing.
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

account-heading = Chordless Account
account-teams-spaces-heading = Your teams
account-personal-heading = Personal space
account-personal-hint = Your own library, just for you: try out Chordless, or keep songs and setlists for events that are not your church's, such as a wedding, a small group or a concert.
account-churches-heading = Churches and organisations
account-churches-hint = Register your organisation or church to share songs and setlists with its teams.
account-teams-heading = Join or create a Team
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

account-logout = Log out
account-name-label = Name
account-name-none = Not set
account-name-add = Add your name
account-name-save-failed = Saving your name failed: { $reason }
account-emails-label = Emails
account-emails-none = None yet
action-save = Save
name-prompt-heading = What should we call you?
name-prompt-text = This is the name your team sees, and the one on your own setlists. You can change it any time on the Account page.
name-prompt-later = Not now
action-edit = Edit
# The name of someone whose Google account gave none.
account-status-expired = Sign-in expired: reconnect to sync

# What the card says after something was done. { $reason } is what went wrong.
account-signed-in = Signed in.
account-signed-in-no-drive = Signed in. Google Drive was not connected, so your own spaces will not sync yet.
account-signin-failed = Signing in failed: { $reason }
account-logged-out = Logged out on this device.
account-logout-failed = Logging out failed: { $reason }
# { $old } and { $new } are the times the token was due to expire before and after.

storage-heading = Storage Usage
storage-browser-data = Song and setlist data
storage-app-cache = Application code
storage-media-cache = Media Data (e.g. Pads)
storage-unreadable = Unable to read local storage details.
storage-footnote = Data stored on this device only.


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
pref-play-text = What each song shows when you open it, and which controls you get.
pref-lyrics-only = By default show only the lyrics
pref-show-capo = Show the capo and tuning controls
pref-show-pitch = Show the instrument pitch controls
pref-my-instrument = My instrument
pref-pitch-text = Each setlist, and each song, can have its own: choose it there, in edit mode.
pref-my-tuning = My guitar is tuned
pref-tuning-text = Each setlist can have its own tuning: choose it on the setlist, in edit mode.

# The choices of "What do you play?" (and the first-use setup): the choice and a line under it.
play-singer = I sing, or play drums
play-singer-description = Lyrics only by default, and no key controls
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

tuning-standard = Standard (E)
tuning-eb = E♭ standard (-1)
tuning-d = D standard (-2)
tuning-db = D♭ standard (-3)
tuning-c = C standard (-4)
tuning-b = B standard (-5)

pref-chords-heading = Chords
pref-nashville = Nashville numbers instead of letter names
pref-unicode = Unicode accidentals (♯/♭)
pref-leadsheets-heading = Lead sheets
pref-real-book = Real Book style: handwritten notation and chords conventions (-7, ø7, °)
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
wake-refused-detail = The device refused it. Battery Saver can cause this.
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

about-launch-heading = Kept between launches
about-launch-kept = Kept
# { $count } is how many times the app has opened here, { $date } the day of the first ("3 March 2026"), { $ago } when it was last opened ("2 hours ago"; empty if not known).
about-launch-kept-detail = Opened { $count } times on this device, since { $date }. Last opened { $ago }.
about-launch-first = Nothing from an earlier launch
about-launch-first-detail = This is the first time the app has opened here, or this device cleared its data since the last time. If you have used Chordless here before, tell support: it is worth knowing.
about-launch-partial = Partly cleared
# { $cleared } is the stores that were empty, such as "localStorage".
about-launch-partial-detail = This device cleared { $cleared } since the last launch, and kept the rest.
about-launch-local = localStorage
about-launch-database = IndexedDB
about-launch-unknown = Can't tell
about-launch-unknown-detail = This browser would not let the app keep a note between launches.


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


## The first time (the questions on first use, the welcome card, and why to install)

first-use-heading = Welcome to Chordless
first-use-intro = Chordless is an application for managing and using setlists for bands. A few quick questions to set up some defaults for you:
first-use-later = You can change this later in Preferences, where each setting can be set by itself.
first-use-skip = Skip
first-use-continue = Continue

welcome-lead = Chordless shows the lyrics and chords of your worship songs, arranged into a setlist for each service. It works offline, so it is ready even when the wifi is not.

welcome-samples-heading = Try it
welcome-samples-text = Add a sample setlist of four public-domain hymns, to see how it works.
welcome-samples-button = Add a sample setlist
# { $reason } is what went wrong.
welcome-sample-failed = Could not add the sample setlist: { $reason }

welcome-songs-heading = Add your own songs
welcome-songs-text = Import ChordPro files, or paste the text of a song. If your church has a CCLI licence, the SongSelect bookmarklet adds songs straight from SongSelect.
welcome-songs-button = Import songs

welcome-safe-heading = Keep them safe
welcome-safe-text = Sign in to keep your songs and setlists in your own Google Drive, and to share them between your devices.
welcome-safe-button = Sign in and sync

welcome-install-heading = Install it
welcome-install-text = Browsers can clear the saved data of a website that has not been used for a while: Safari does after about a week. An installed app is kept, and opens full screen, so your songs are there when you need them.
# Added after the text above, with a space, where the installed app is not the browser (it keeps its own data).
welcome-install-separate-data = The installed app keeps its own data, separate from Safari's, so you will need to sign in again in it.
# <strong> is the name of a button.
welcome-install-ios = Tap the <strong>Share</strong> button in your browser, then choose <strong>Add to Home Screen</strong>.
welcome-install-mac = In the menu bar, choose <strong>File</strong>, then <strong>Add to Dock</strong>.

why-install-link = Why install?
why-install-heading = Why install Chordless?
# <strong> is the lead of each reason.
why-install-stay = <strong>Your songs stay put.</strong> A browser can clear the saved data of a website it thinks is unused (Safari does after about a week). An installed app is protected from that, so your songs and setlists are still there on the day.
why-install-screen = <strong>The whole screen for the song.</strong> No address bar or tabs getting in the way.
why-install-feel = <strong>Feels like any other app you use.</strong> It has its own icon, opens in its own window, and shows up in your app switcher.
why-install-ios = On an iPhone or iPad the installed app keeps its own data, separate from Safari's, so you sign in again in it.
why-install-not-needed = Chordless works offline, checks for updates and can keep the screen awake in a browser tab too. Installing isn't needed for those.


## Importing songs from SongSelect (the bookmarklet, and how to install it)

# <strong> is the question that starts it.
ss-touch-tip = <strong>On a phone or tablet?</strong> The bookmarklet works best on a computer. Instead, download the song's ChordPro file from SongSelect, then choose it with "Import ChordPro Files" above.
ss-lead = Import songs from SongSelect directly into your Chordless library with one click using this bookmarklet.
ss-install-heading = Install Bookmarklet
ss-drag = <strong>Drag this button to your bookmarks bar:</strong>
ss-alt-heading = Alternative Method
# The two forms of a sentence: one for a computer, one for a phone or tablet.
ss-alt-text-desktop = If dragging doesn't work, you can create the bookmark yourself:
ss-alt-text-touch = You can create the bookmark yourself:
ss-alt-step-1-desktop = Create a new bookmark (Ctrl+D or Cmd+D)
ss-alt-step-1-touch = Create a new bookmark of any page, then edit it
ss-alt-step-2 = Name it "🎵 Import to Chordless"
ss-alt-step-3 = Copy the code below and paste it as the URL
ss-desktop-heading = Desktop Installation
# <strong> is what to do and <code> a key to press.
ss-desktop-1 = <strong>Show your bookmarks bar:</strong> Press <code>Ctrl+Shift+B</code> (Windows) or <code>Cmd+Shift+B</code> (Mac)
ss-desktop-2 = <strong>Drag the purple button above</strong> to your bookmarks bar
ss-desktop-3 = Navigate to a song page on SongSelect
ss-desktop-4 = Click the bookmark
ss-mobile-heading = Mobile Installation
ss-mobile-1 = The easiest way on a phone or tablet is to download the song's ChordPro file from SongSelect, then choose it with "Import ChordPro Files" above.
ss-mobile-2 = To use the bookmarklet anyway, bookmark any page, then edit the bookmark and paste the code from the "Alternative Method" above as its URL. On Android, run it by typing the bookmark's name in the address bar and tapping it.
ss-mobile-3 = On iPhone and iPad, songs it imports in Safari don't reach Chordless installed on the home screen, which keeps its own separate storage.
ss-how-heading = How It Works
ss-how-1 = Navigate to a song on SongSelect
ss-how-2 = Click the bookmarklet
ss-how-3 = It opens Chordless's Import Songs page, and downloads the song's ChordPro file from SongSelect using your login
ss-how-4 = It sends the song to Chordless, which saves it to your library
ss-how-5 = Choose a setlist to add it to, or just keep it in the library

bookmarklet-name = 🎵 Import to Chordless
bookmarklet-drag = Drag me to your bookmarks bar
bookmarklet-code-label = Bookmarklet code
bookmarklet-copy = 📋 Copy Code
bookmarklet-copied = ✅ Copied. Paste it as the new bookmark's URL.
bookmarklet-copy-failed = Copying was blocked: the code is selected, copy it from there.


## Importing songs (the page for files, pasted text and the bookmarklet, and what it says of each song)

import-waiting = Waiting for SongSelect…
import-reading-pdf = Reading the PDF…
import-reading-song = Reading the song…
import-reading-leadsheet = Reading the lead sheet…
# What a song that came as shared text or pasted text is called, where a list of what was not imported names it.
import-name-shared = Shared text
import-name-pasted = Pasted text

# { $reason } is what went wrong.
import-chart-failed = Failed to read the chart: { $reason }
# { $skipped } is a list of what was left out, and why.
import-none = No songs to import. { $skipped }
import-process-failed = Failed to process song: { $reason }
import-save-failed = Failed to save song: { $reason }
import-setlist-failed = Failed to create setlist: { $reason }
import-song-failed = Failed to import the song: { $reason }
import-skipped = Not imported: { $skipped }

# A chart from an email or a PDF that has no song in the library to go with. <strong> is the title it has.
import-unmatched = Not in your library: <strong>{ $title }</strong>
# The button that takes a song of the library in its place. { $title } is the song.
import-use = Use { $title }
import-find = Find it on SongSelect ↗

import-already-updated = This song was already in your library, as the same song. It has been updated.
import-already-identical = An identical version of this song is already in your library, nothing to import.
# Added to the sentence above, with a space.
import-already-source = Its source is now recorded as SongSelect.

# The melody's range. { $notes } is "C4–G5", { $key } the key of the chart.
import-range = Melody range { $notes } in { $key }.
import-range-by-hand = Melody range { $notes } in { $key }, set by you.
import-range-lead-sheet = Melody range { $notes } in { $key }, from the lead sheet.
# { $signature } is the key the lead sheet is in.
import-range-other-key = The lead sheet is in another key than the chart ({ $signature }; the chart is in { $key }), so its range was not used.
import-range-no-melody = The lead sheet had no melody to read, so there is no range.
import-range-unreadable = The lead sheet could not be read, so there is no range.
import-range-none = No lead sheet came with this song, so there is no range.
import-melody-not-saved = The lead sheet could not be saved, so the song has only its range.
import-melody-kept = The lead sheet is kept with the song.

import-range-set = Set the range yourself
import-range-lowest = Lowest note
import-range-highest = Highest note
import-range-save = Save the range
import-range-note = In { $key }, as written: men sing it an octave down.
import-range-wrong = The lowest note is above the highest.

import-how-read = How the lead sheet was read
# { $bars } bars and { $notes } sung notes were read.
import-read =
    { $bars ->
        [one] 1 bar
       *[other] { $bars } bars
    }: { $notes ->
        [one] 1 sung note
       *[other] { $notes } sung notes
    } read.
# The same, with what was left out in { $left } (a list: "2 small instrumental notes and 1 note with no lyric").
import-read-left-out =
    { $bars ->
        [one] 1 bar
       *[other] { $bars } bars
    }: { $notes ->
        [one] 1 sung note
       *[other] { $notes } sung notes
    } read, and left out { $left }.
import-left-instrumental =
    { $count ->
        [one] 1 small instrumental note
       *[other] { $count } small instrumental notes
    }
import-left-unsung =
    { $count ->
        [one] 1 note with no lyric
       *[other] { $count } notes with no lyric
    }
import-read-key = Key signature: { $signature }. The chart is in { $key }.
import-read-lowest = Lowest note { $note }: bar { $bar }.
import-read-highest = Highest note { $note }: bar { $bar }.

# The heading once songs have come in: { $title } for one, { $count } for several.
import-done-one = ✅ { $title }
import-done-many = ✅ { $count } songs
import-progress = Importing { $n } of { $total }…
import-show-songs = Show the { $count } songs

import-into = Import into
# { $space } is the name of a Team.
import-space-team = { $space } (Team)

import-manual = Import a file or paste instead
import-files = Import ChordPro Files
import-files-text =
    Select one or more ChordPro files

    If they are SongSelect chordpro files, please also download and import the matching lead sheet PDF, which will provide the melody and enable showing the leadsheet.
import-paste = Paste ChordPro
import-button = Import
import-email = Import a Setlist from an Email
import-email-text = Forward a leader's email to Chordless
import-songselect = Import from SongSelect (CCLI) with a bookmarklet

import-add-to-setlist = Add to Setlist
import-add = Add
setlist-create-heading = Create New Setlist
import-create-add-one = Create & Add Song
import-create-add-many = Create & Add Songs
import-fresh-one = Start a fresh setlist with this song
import-fresh-many = Start a fresh setlist with these songs
import-save-library = Save to Library Only
import-no-setlist = Don't add to any setlist
import-go-library = Go to the Library
import-nothing-one = Nothing to save: it is in the library
import-nothing-many = Nothing to save: they are all in the library


## What to do with a song the library has (the choices when a song coming in is already there)

# What came of each song, in the list of them (and counted: "3 new; 2 updated"). Lower case: it follows the song's name.
import-status-new = new
import-status-updated = updated
import-status-original = imported as the original
import-status-variant = imported as a variant
import-status-not-imported = not imported
import-status-same-song = updated: the same song as in your library
import-status-identical = identical version already in library
import-status-identical-source = identical version already in library, now recorded as from SongSelect
import-status-in-library = already in library

# How the chart coming in compares with the one the library has.
import-verdict-identical = The same song.
import-verdict-same-chart = The same words and chords, with other details.
import-verdict-other-key = The same song in another key.
import-verdict-different-chords = The same words, with different chords.
import-verdict-different-words = Different words: another version or arrangement.

# The headings over the two charts when they are compared.
import-chart-library = In your library
import-chart-importing = Importing

import-pick-legend = What to do with it
import-pick-original = Import as original song version
import-pick-original-help = The imported song becomes the original. Your current song is kept as a variant.
import-pick-variant = Import as variant of original
import-pick-variant-help = Your current song stays the original. The imported song is kept as a variant.
import-pick-update = Update current song
import-pick-update-help = Replace your current song with the imported one, in its key. Setlists keep using it, and keep the keys they have it in.
import-pick-skip = Do not import
import-pick-skip-help = Keep your current song as it is.
import-label-current = Variant name for your current song
import-label-imported = Variant name for the imported song
import-compare = Compare

import-duplicate-one = This song already exists in your library
# { $count } is how many of the songs coming in are already there.
import-duplicate-many =
    { $count ->
        [one] 1 of these songs is already in your library
       *[other] { $count } of these songs are already in your library
    }
import-bulk-label = The same choice for all of them
import-bulk = For all of them:
import-bulk-update = Update all { $count }
import-bulk-skip = Do not import any
import-bulk-apply = Import all with these choices

# Where a song came from, beside it. { $user } is who imported it.
origin-imported-by = Imported by { $user }
origin-unknown = Importer unknown


## Importing a setlist from an email (the page that opens from the link Chordless replies with)

email-import-heading = Import a setlist from an email
# <mail> is the address to forward to, as a link. { $address } is that address.
email-import-text =
    Forward the email a worship leader sent, with the songs attached as PDFs, to <mail>{ $address }</mail>. Chordless will read the email and PDFs, attempt to determine the songs.

    It will reply to your email with a link. When you open it, it will show a proposed setlist for you to check and import.
email-import-privacy = Chordless doesn't import the PDFs from the email, just uses them to identify the songs. If you do not have the song imported, you will need to import it properly. The email and its charts are not kept.
email-import-reading = Reading the email…
# { $reason } is what went wrong.
email-import-link-failed = Could not read that link: { $reason }
email-import-create-failed = Could not create the setlist: { $reason }

# The heading of the review, for an email with no subject.
email-import-untitled = Setlist from an email
email-import-start-over = Start over
# { $warning } is why the date is doubtful ("Sunday 12 October is a Saturday", from the email).
email-import-date-warning = { $warning }. Check the date below.
email-import-no-date = The email gave no date: check the one below (the nearest Sunday).
email-import-setlist = Setlist
email-import-songs = Songs
email-import-no-list = The email had no list of songs, so they are in the order the charts were attached. Check the order.

# Songs the email has that the library does not. <bookmarklet> is a link to the SongSelect bookmarklet. { $count } is how many.
email-import-missing-one = 1 song is not in your library yet. Open it on SongSelect and import it with the <bookmarklet>SongSelect bookmarklet</bookmarklet> (when asked where to put it, keep it in the library), then come back here: this page looks again when you return. Or leave it out.
email-import-missing-many = { $count } songs are not in your library yet. Open each on SongSelect and import it with the <bookmarklet>SongSelect bookmarklet</bookmarklet> (when asked where to put it, keep it in the library), then come back here: this page looks again when you return. Or leave a song out.

email-import-saving = Saving…
email-import-update = Update setlist
email-import-create = Create setlist

# Who leads. { $label } is the leader as the email names them, <strong> the person it matched.
email-import-who-leads = Who leads
email-import-leader-match = The email's leader, “{ $label }”, is <strong>{ $person }</strong> by name.
email-import-leader-suggest = The email's leader, “{ $label }”, might be one of your people. Who is it?
email-import-leader-new = The email's leader, “{ $label }”, is not one of your people yet.
# Added after one of the three above, with a space. { $email } is the address in the email.
email-import-learns = { $email } is added to them, so the next email from it is matched by its address.
email-import-new-person = A new person: { $label }

# When the library already has a setlist for the date. { $date } is the date.
email-import-same-date-label = A setlist for this date
email-import-same-date-one = You already have a setlist for { $date }
email-import-same-date-many = You already have setlists for { $date }
# <setlist> is a link to the setlist. { $setlist } is its name.
email-import-update-target = Update <setlist>{ $setlist }</setlist>
email-import-new-setlist = Make a new setlist

# What updating would change.
email-import-a-song = A song
email-import-changes-label = Changes to the setlist
# { $setlist } is the name of the setlist.
email-import-changes = Changes to { $setlist }
email-import-changes-unnamed = Changes to the setlist
email-import-adds = Adds { $title }
email-import-keep = Keep { $title }, which the email does not have (it is removed otherwise)
# { $from } and { $to } are the old and the new key.
email-import-key-change = { $title }: key { $from } → { $to }
email-import-no-key = none
email-import-reordered = The songs are in the email’s order
email-import-nothing = The email has the same songs, in the same order and keys: nothing changes.
email-import-left-as-is = Its date, name, time and leader are left as they are.

# One song of the email.
email-import-include = Include { $title }
email-import-listed-as = listed as “{ $listed }”
email-import-paired = The email attached “{ $title }” in the same key, and no other song was left: taken to be this one.
email-import-key = Key
email-import-note = Note
email-import-in-library = ✓ In your library
# { $space } is the space the song is in, if not this one.
email-import-in-space = ✓ In “{ $space }”: it is copied into your library when you create the setlist
email-import-by-lyrics = No song has that title, but its words are in these:
email-import-is-it = Is it one of these?
email-import-which = Which song is { $title }
email-import-none-of-these = None of these
email-import-not-in-library = Not in your library.
email-import-open = Open it on SongSelect ↗
email-import-search = Search SongSelect for it ↗
email-import-leave-out = Leave it out

email-import-unlisted = Charts attached but not in the list
email-import-unlisted-label = Songs attached but not listed
email-import-add = Add { $title }


## The header, the pickers for key, capo, instrument and tuning, and a song's settings

menu-label-update = Navigation menu, update ready
header-edit-toggle = Toggle edit mode
header-info = Information

selector-key = Key
selector-capo = Capo
selector-instrument = Instrument
selector-tuning = Tuning
selector-options = Options
# What a setlist's or song's own choice follows when it makes none: "Same as { $follows }".
selector-follows-device = my device
selector-same-as = Same as { $follows }
selector-same-as-device = Same as my device
capo-open = Open
# { $count } is how many frets down the capo takes the chords when the key is not known.
capo-down = Down { $count }

# How a key fits the melody's range, said by a screen reader and in the badge's tip ("too high, low").
range-in-range = in range
range-high = high
range-low = low
range-too-high = too high
range-too-low = too low

settings-label = Song settings
settings-bpm = BPM:
settings-bpm-down = Decrease BPM
settings-bpm-up = Increase BPM
settings-pads = Pads:
settings-pad-default = Default
# A pad set this person chose that is no longer on the device.
settings-pad-missing = Not on this device
settings-reset = Reset
settings-reset-label = Reset song


## The media player

player-settings-heading = Media Player Settings
player-status-download = DOWNLOAD
player-status-playing = PLAYING
player-status-stopped = STOPPED
player-next = Next
player-key = Key
player-bpm = BPM
player-time = Time
player-on = On
player-off = Off
player-start = Start song
player-start-space = Start song (Space)
player-stop = Stop
player-stop-escape = Stop (Escape)
player-stop-escape-title = Stop - Press Escape
player-expand = Expand player
player-double-click = Double-speed click for this song
player-settings = Settings
player-minimize = Minimize
player-knob-click = Click
player-knob-pads = Pads
player-volume-pad = Pad Volume
player-volume-click = Click Volume
player-toggle-click = Toggle click on/off
player-toggle-pads = Toggle pads on/off


## A setlist's details (the form, and what the dialog says of a setlist)

action-remove = Remove
songs-count =
    { $count ->
        [one] { $count } song
       *[other] { $count } songs
    }

details-date = Date
details-time = Time
details-type = Type
details-name = Name (optional)
details-name-example = e.g. Youth Service, Christmas Special
details-leader = Leader (optional)
details-no-leader = No leader
# { $name } is the person who is using the app.
details-leader-you = { $name } (you)
details-leader-other = Other…
details-leader-name = Leader's name
details-who = Which of these is you?
details-who-unsure = Not sure yet
details-who-new = None of these: add me

setlist-info-heading = Setlist info
# { $title } is the setlist's name and date.
setlist-info-edit = Edit: { $title }
setlist-info-edit-label = Edit setlist details
setlist-info-wrong-space = Added to the wrong space?
setlist-info-move = Move to this space
setlist-info-delete = Delete setlist
# { $space } is the Team the setlist is in.
setlist-info-delete-blocked = In { $space }, only the leader of a setlist or an admin can delete it.
# { $leader } is the person who leads it.
setlist-only-leader = Only { $leader } or an admin can change this setlist.
setlist-only-its-leader = Only its leader or an admin can change this setlist.

info-time = Time
info-type = Type
info-leader = Leader
info-venue = Venue
info-songs = Songs
info-created = Created
info-modified = Last Modified


## A song's details (the dialog on a song, and how long ago it was played)

song-info-heading = Song info
song-info-artist = Artist
song-info-key-tempo = Original Key / Tempo
song-info-key = Key: { $key }
song-info-key-and-tempo = Key: { $key } • { $tempo } BPM
song-info-time-signature = Time Signature
song-info-copyright = Copyright
song-info-played = Times Played (Total)
song-info-recent = Recent Plays

song-info-range = Melody Range
song-info-range-none = None yet
song-info-range-add = Add a range
song-info-range-edit = Edit
# { $key } is the key the chart is in.
song-info-range-in-key = in { $key }
# { $notes } notes and { $semitones } semitones from the lowest to the highest.
song-info-range-width =
    Vocal range: { $notes ->
        [one] 1 note
       *[other] { $notes } notes
    } wide ({ $semitones ->
        [one] 1 semitone
       *[other] { $semitones } semitones
    })
# How far the range is moved to sit in the singing range: "an octave lower", "2 octaves higher".
song-info-octaves-lower =
    { $count ->
        [one] an octave
       *[other] { $count } octaves
    } lower
song-info-octaves-higher =
    { $count ->
        [one] an octave
       *[other] { $count } octaves
    } higher
# { $note } is the note, { $shown } how long it is held and { $beats } the same as a number (for "beat" and "beats").
song-info-highest =
    Highest { $note }: { $shown } { $beats ->
        [one] beat
       *[other] beats
    }
song-info-lowest =
    lowest { $note }: { $shown } { $beats ->
        [one] beat
       *[other] beats
    }

song-info-ccli = CCLI Number
song-info-songselect = SongSelect
song-info-view = View on SongSelect

# How long ago a date was, or how long until it: the dates of a song's plays, and of a setlist. { $count } is the number.
when-today = today
when-yesterday = yesterday
when-tomorrow = tomorrow
when-days-ahead =
    { $count ->
        [one] in { $count } day
       *[other] in { $count } days
    }
when-weeks-ahead =
    { $count ->
        [one] in { $count } week
       *[other] in { $count } weeks
    }
when-days-ago =
    { $count ->
        [one] { $count } day ago
       *[other] { $count } days ago
    }
when-weeks-ago =
    { $count ->
        [one] { $count } week ago
       *[other] { $count } weeks ago
    }
when-years-ago =
    { $count ->
        [one] { $count } year ago
       *[other] { $count } years ago
    }


## Deleting a Team or space everywhere

de-only-admin = Only an admin can delete a Team everywhere.
de-button = Delete everywhere…
de-sign-in = Connect Google Drive to reach its folder.
# { $space } is the name of the space.
de-heading = Delete "{ $space }" everywhere?
de-what-team = This ends sharing for everyone in the Team, and deletes it from Google Drive.
de-what-personal = This deletes it from this device and from Google Drive.
# Added after one of the two above, with a space, when it is known what the space holds.
de-holds =
    It holds { $songs ->
        [one] 1 song
       *[other] { $songs } songs
    } and { $setlists ->
        [one] 1 setlist
       *[other] { $setlists } setlists
    } here.
de-item-trash = Its folder in Google Drive, with everything in it, goes to the Drive trash. You can restore it from there for thirty days.
de-item-team = Its members can no longer sync it, and nobody can join it with an invitation. Each device keeps its own copy until it is deleted there.
de-item-personal = Your other devices stop syncing it: they will say its Drive folder is gone.
de-item-device = This device's copy is deleted. It cannot be undone.
# <strong> is the number and name of the step.
de-step-backup = <strong>1. Keep a backup.</strong>
de-backup-text = The backup is an export file with its songs and setlists as they are on this device: sync first if others have changed it. It does not have the audio pads.
de-backup-button = Download a backup
de-backup-again = Download it again
# { $file } is the name of the file, { $size } its size ("1.2 MB").
de-backup-done = ✓ { $file } ({ $size }) was handed to your browser.
de-backup-needed = Needed before you can delete.
de-backup-failed = The backup could not be made: { $reason }
# { $space } is the name of the space the person types.
de-step-name = <strong>2. Type the name,</strong> { $space }, to confirm.
de-deleting = Deleting…
de-do-delete = Delete everywhere


## Exporting a space, and importing an export (a zip file of its songs and setlists)

export-button = 📦 Export this space
export-exporting = Exporting…
export-choose = 📥 Import a Chordless export…
export-include-pads = Include my pad sets ({ $count }, about { $size })
export-include-personal = Include my own settings and annotations (capo, tuning, sections shown, private annotations). They are private: leave this off for a file you will share.
# { $file } is the name of the file, { $size } its size.
export-done = Exported as { $file } ({ $size }).
export-failed = Exporting failed: { $reason }

export-import-legend = Import this export into { $space }
# { $space } is where the export is from, { $when } when it was made.
export-from = Exported from { $space }, { $when }: { $songs } charts, { $setlists } setlists.
export-from-pads = Exported from { $space }, { $when }: { $songs } charts, { $setlists } setlists, { $padSets } pad sets.
export-import-note = Import adds only what is missing and deletes nothing; “Reset from this export” also replaces the charts and setlists here that differ from the file's.
export-also-personal = Also put back the file's own settings and annotations (capo, tuning, sections shown, private annotations, songs added for the person alone). What this device already keeps is left as it is.
export-also-pads = Also upload its pad sets to Google Drive. A pad set with the same name there is replaced.
export-also-pads-offline = Also upload its pad sets to Google Drive (connect with Google first). A pad set with the same name there is replaced.
export-importing = Importing…
export-reset-start = Reset from this export…
import-failed = Importing failed: { $reason }
export-check-failed = Could not check the space: { $reason }

# What an import did: the first clause, then each of the others that is so (a semicolon between, and a full stop at the end).
export-imported = Imported into { $where }: { $songsAdded } charts and { $setlistsAdded } setlists added, { $songsSkipped } charts and { $setlistsSkipped } setlists were already there
export-lead-sheets-added =
    { $count ->
        [one] 1 lead sheet
       *[other] { $count } lead sheets
    } added
export-personal-restored =
    your own settings and annotations put back for { $count ->
        [one] 1 setlist
       *[other] { $count } setlists
    }
export-pads-uploaded = { $count } pad sets uploaded to Drive

export-reset-legend = Reset { $space } to this export
export-reset-plan = { $songsReplaced } charts and { $setlistsReplaced } setlists here will be replaced by the file's, and { $songsAdded } charts and { $setlistsAdded } setlists added. { $same } are already the same.
export-reset-only-here = { $songs } charts and { $setlists } setlists that are here and not in the file are kept: nothing is deleted.
export-reset-drive = They keep their place in Drive, so sync sends the changes as edits to the same files.
# { $count } things changed here after the file was made, { $labels } the first of them.
export-reset-newer = { $count } changed here after the file was made, and the file's version will replace it: { $labels }.
# The same, with { $more } not named.
export-reset-newer-more = { $count } changed here after the file was made, and the file's version will replace it: { $labels }, and { $more } more.
export-first = 📦 Export this space first, as a backup
export-resetting = Resetting…
export-nothing = Nothing to change
export-reset-button = Reset
export-reset-failed = Resetting failed: { $reason }
# What a reset did: the first clause, each of the others that is so, then the last sentence.
export-reset-done = Reset { $where } from the export: { $songsReplaced } charts and { $setlistsReplaced } setlists replaced, { $songsAdded } charts and { $setlistsAdded } setlists added, { $songsSame } charts and { $setlistsSame } setlists were already the same
export-reset-kept = { $songs } charts and { $setlists } setlists that are not in the file were kept
export-reset-sync = Sync sends the changes to Drive.


## Making a Team (the page that makes a Team space, and what it asks)

wizard-heading = New team space
wizard-sign-in-text = A team space keeps its songs and setlists in a folder in your Google Drive, so Chordless needs to be signed in and to have Google Drive connected to make it.
wizard-connect-drive = 📁 Connect Google Drive
wizard-intro = A new space for your team, separate from your personal space. Everyone you invite keeps its songs and setlists in step.
wizard-name = Team name
wizard-name-example = St Mary's Music
wizard-licence = CCLI licence number (optional)
wizard-licence-text = Your church's Church Copyright Licence number, kept for your records. It is not checked, and you can leave it blank for now.
wizard-folder = Where to keep it in Google Drive
wizard-folder-choose = 📁 Choose a folder…
wizard-folder-change = 📁 Choose a different folder
wizard-folder-text = A shared drive is best: the files stay with the team if you leave, and everyone can see them in Drive. A folder in your own Drive works too. Chordless makes a folder inside the one you choose, named for the team, with “Chordless” after it.
wizard-create = Create team space
wizard-creating = Creating…
# What it is doing, while the space is made.
wizard-stage-making = Making the space…
wizard-stage-bringing = Bringing your songs and setlists across…
wizard-stage-saving = Saving to Google Drive…

# Bringing songs and setlists from a space of the person's own.
wizard-bring = Bring across
wizard-from-label = From
# { $source } is the name of the space they come from.
wizard-from = From { $source }
# { $amount } is how many, and how big ("12, 1.2 MB").
wizard-songs = Songs ({ $amount }), copied
wizard-setlists = Setlists ({ $amount }), with the songs they use
wizard-mode-label = What happens to the setlists
wizard-move = Move them: they leave { $source }
wizard-copy = Keep a copy in { $source }

# When the space is made. { $name } is its name.
wizard-ready = { $name } is ready
wizard-ready-text = It is a new space with its own folder in Google Drive.
wizard-open = Open { $name }
# What came across, after the sentence above, with a space: the things that did, as a list ("2 songs and 1 setlist").
wizard-came = { $list } came across.
wizard-came-songs =
    { $count ->
        [one] 1 song
       *[other] { $count } songs
    }
wizard-came-setlists =
    { $count ->
        [one] 1 setlist
       *[other] { $count } setlists
    }
wizard-came-nothing = Nothing new came across.
wizard-bring-failed = Couldn't bring your songs across: { $reason }
wizard-save-failed = Couldn’t save it to Google Drive yet, so the team can’t get it: { $reason }


## Inviting people to a Team that was just made

invite-heading = Invite your team
invite-text-leaders = These people lead setlists you brought across. Tick who to invite and what they may do, or add an email address.
invite-text = Add the email address of the Google account each person will sign in with.
# After one of the two above, with a space.
invite-text-links = You get a link for each, to send yourself: it works once, for a week, and only for that account.
invite-roles = A worship leader can edit songs and setlists, a team member can see them, and an admin can also look after the people.
# { $email } is the person.
invite-role-label = Role of { $email }
# { $names } is a list of people with no email address.
invite-name-only = No email address, so they can't be invited from here: { $names }.
invite-email-example = name@example.com
invite-another-label = Another email address
invite-making = Making invites…
invite-make =
    { $count ->
        [one] Make 1 invite
       *[other] Make { $count } invites
    }
invite-invites-heading = Invites
invite-invites-text = Each is emailed to that person. The links are shown once, in case you want to send one another way.
invite-link-label = Invite link for { $email }
invite-copy = Copy the link
invite-copied = ✓ Copied
action-add = Add


## A Team's CCLI licence number

licence-heading = CCLI licence number
licence-text = Your church's Church Copyright Licence number. Chordless keeps it with the team, as a record of who is using it, and may be asked for it by CCLI. It is not checked.
licence-label = Licence number
licence-admin-only = Only an admin can change it.
licence-saved = Saved
licence-history-label = Changes to the licence number
# After "{ date }: { who } ": what they did.
licence-changed = changed it from { $from } to { $to }
licence-set = set it to { $to }
licence-cleared = cleared it (was { $from })


## Where a Team's files are reached from

storage-team-heading = Team storage
storage-copy = Copy
storage-copied = Copied
storage-service-account = This Team reaches its files with Chordless’s own account, a Content manager of your shared drive, so it does not depend on your Google Drive connection.
storage-go-back = Use my Google Drive instead
storage-own-sign-in = This Team reaches its files with your Google Drive, so its syncing stops if you leave or your Google Drive connection stops working.
storage-switch-text = If the Team’s folder is in a Google shared drive, Chordless can reach it with an account of its own instead. Add this address to the shared drive as a Content manager, then check it:
storage-switch = Check and switch


## The pages: their headings, the titles of the browser's tabs, and the notes round them

# The title of the browser's tab for each page.
title-setlist = Setlist - Chordless
title-shared = Shared setlist - Chordless
title-not-found = Not found - Chordless
title-account = Account and Teams - Chordless
title-preferences = Preferences - Chordless
title-import-songs = Import Songs - Chordless
title-space = Space - Chordless
title-sign-in = Sign in - Chordless
title-import-setlist = Import a Setlist - Chordless
title-library = Song Library - Chordless
title-about = About - Chordless
title-contact = Contact - Chordless
title-speed-test = Speed test - Chordless
title-join = Join a team space - Chordless
title-media = Media player - Chordless
title-new-team = New team space - Chordless

page-loading = Loading...
page-not-found = Not found
page-not-found-heading = Page not found
page-not-found-link = Go to the setlists
page-import-setlist = Import a Setlist
page-join = Join a team space
page-sign-in = Sign in
page-space = Space
page-media = Media player
page-shared = Shared setlist
page-load-failed = This page could not be loaded. Reload to try again.

# The links along the bottom of the About, Preferences and Contact pages.
footer-contact = Contact
footer-privacy = Privacy policy
footer-terms = Terms of service
footer-licences = Open source licences

about-heading = About Chordless
about-blurb = Chordless shows the lyrics and chords of worship songs for church, as a setlist you can arrange and play from. Chords can be hidden or shown for each verse, the key can be changed, and one touch moves between songs. It works offline, and your songs are kept in your own Google Drive.

home-create = Create new setlist
home-create-submit = Create Setlist
home-create-into = Create in
home-current-upcoming = Current and upcoming
home-history = Past setlists

setlist-go-live = Go live
setlist-share = Share setlist
songs-search = Search songs by title, artist, or lyrics...
songs-search-start = Start typing to search songs...

# A song of another space, shown in the library. { $source } is that space.
library-select = Select a song to view

media-page-text = Pads and a click track for your setlists. These settings apply to all of them.
score-failed = The lead sheet could not be shown for this song.
toast-details = Details
toast-dismiss = Dismiss
modal-close = Close
progress-label = Progress


## A setlist that was shared by a link (what a person sees who opens one)

share-what = What is Chordless?
share-go = Go to Chordless
# <strong> is who shared it, { $owner }; { $until } is the day it ends.
share-banner = Shared with you. You can read it here, with no account.
share-banner-owner = Shared with you by <strong>{ $owner }</strong>. You can read it here, with no account.
share-banner-until = Shared with you. You can read it here, with no account, until { $until }.
share-banner-owner-until = Shared with you by <strong>{ $owner }</strong>. You can read it here, with no account, until { $until }.

# What it says when the link cannot show the setlist: a heading and a line under it.
share-loading = Opening…
share-loading-text = Getting the setlist.
share-ended = This share has ended
share-ended-text = The person who sent it stopped sharing, or it has expired. Ask them for a new link if you still need it.
share-incomplete = This link is incomplete
share-incomplete-text = The end of the link is missing, so the setlist cannot be opened. Ask for the whole link again, or scan its QR code.
share-bad-key = This link doesn't open the setlist
share-bad-key-text = The link looks cut short or changed. Ask for it again, or scan its QR code.
share-unreachable = Can't reach the setlist
share-unreachable-text = Connect to the internet and open the link again. After that it works without a connection.
share-offline = You're offline

## When something could not be done (what a person is told when the reason is not for them)

# Where an error was written for developers, a person is told what could not be done, in words: the error is kept for the reports.
error-something = Something went wrong

people-failed = Couldn't make that change to the people.
de-delete-failed = Couldn't delete it.
join-failed = Couldn't join the team space.
wizard-connect-failed = Couldn't connect to Google.
wizard-folder-failed = Couldn't choose the folder.
wizard-create-failed = Couldn't make the team space.
drive-sync-reset-failed = Couldn't reset from Google Drive.
drive-sync-start-over-failed = Couldn't start over in Google Drive.
drive-sync-replace-failed = Couldn't replace this device's copy.
licence-load-failed = Couldn't read the licence number.
licence-save-failed = Couldn't save the licence number.
name-save-failed = Couldn't save your name.
storage-load-failed = Couldn't check how this Team's files are reached.
storage-switch-failed = Couldn't switch how this Team's files are reached.
membership-failed = Couldn't make that change to the Team.
pads-select-failed = Couldn't use that pad set.
pads-upload-failed = Failed to upload pad set.
pads-select-zip = Please select a ZIP file to upload.
export-read-failed = Couldn't read that file.


## Errors that are written for the person who reads them (thrown as a UserError)

pads-space-unavailable = That pad set’s space is not available: pad sets are kept with a space, in its Google Drive folder or on Chordless
pads-no-file = Please select a pad set ZIP file.
pads-no-name = Please provide a pad set name.
# { $keys } is the notes a pad set lacks a sound for ("D, F#").
pads-missing-keys = Missing keys in pad set: { $keys }
pads-gone = That pad set is no longer where it was kept.
pads-encrypted = Encrypted ZIP archives are not supported.

team-needs-name = A team space needs a name
team-sign-in-first = Sign in first
de-error-admin = Only an admin can delete a Team everywhere

export-not-zip = That file is not a Chordless export: it is not a ZIP file
# { $name } is the file the export lacks.
export-entry-missing = That file is not a Chordless export: { $name } is missing
export-bad-manifest = That file is not a Chordless export: its manifest cannot be read
export-not-export = That file is not a Chordless export
export-too-new = That export was made by a newer Chordless: update the app to import it

# A reset that was stopped: { $count } changes, the first of them in { $shown } ("song Amazing Grace, setlist 12 Oct").
unsynced-error = { $count } local change(s) aren't in Drive yet, so nothing was reset: { $shown }
# The same, when there are more than are named: { $more } of them.
unsynced-error-more = { $count } local change(s) aren't in Drive yet, so nothing was reset: { $shown } and { $more } more
# { $count } songs and setlists are in another folder than { $folder }.
folder-mismatch-error = { $count } setlist(s)/song(s) on this device are stored in a different Google Drive folder than "{ $folder }", the one this space now syncs with. Nothing was synced, to avoid uploading them again as duplicates.
sync-list-failed = Couldn't list your Drive files, so nothing was changed. Try again.
# { $name } is the folder the space looks for.
sync-no-folder = There is no Google Drive folder called "{ $name }" that this app can see, so nothing was changed. Sync it from the device that has the data first.

pads-set-missing-key = Pad set "{ $name }" is missing key: { $key }
pads-set-missing-files = Pad set "{ $name }" is missing files for: { $keys }
join-sync-failed = Couldn't get the team's songs and setlists.


## The same, when the reason is not for the person to read (it is kept for the console and the reports)

account-logout-failed-plain = Logging out failed.
account-name-save-failed-plain = Saving your name failed.
account-signin-failed-plain = Signing in failed.
de-backup-failed-plain = The backup could not be made.
drive-sync-failed-plain = Failed.
email-import-create-failed-plain = Could not create the setlist.
email-import-link-failed-plain = Could not read that link.
export-check-failed-plain = Could not check the space.
export-failed-plain = Exporting failed.
export-reset-failed-plain = Resetting failed.
import-chart-failed-plain = Failed to read the chart.
import-failed-plain = Importing failed.
import-process-failed-plain = Failed to process song.
import-save-failed-plain = Failed to save song.
import-setlist-failed-plain = Failed to create setlist.
import-song-failed-plain = Failed to import the song.
space-sync-failed-plain = Sync failed.
welcome-sample-failed-plain = Could not add the sample setlist.

account-teams-look-failed-plain = Could not look for your teams.
wizard-bring-failed-plain = Couldn't bring your songs across.
wizard-save-failed-plain = Couldn’t save it to Google Drive yet, so the team can’t get it.
import-songselect-failed-plain = Import from SongSelect failed.
# { $reason } is what went wrong.
share-failed = Couldn't do that: { $reason }
share-failed-plain = Couldn't do that.
share-offline-note = You're offline: connect to the internet to share.


## Songs and charts: a song's versions, a song on a card, annotations and a section's controls

action-rename = Rename
action-delete = Delete
action-done = Done

versions-heading = Versions
versions-original = Original
versions-default = Default
# { $origin } is who made the version and when ("Imported by Jo, 3/10/2026"), { $key } its key.
versions-origin-key = { $origin }, key { $key }
versions-variant-name = Variant name
versions-label-example = Alternate
versions-admin-only = Only an admin can delete a song.
versions-delete = Delete
versions-delete-song = Delete song
versions-delete-version = Delete version
versions-confirm-next = Delete this version? Setlists that use it will use the next version instead.
versions-confirm-default = Delete this version? Setlists that use it will use the default instead.
# The question to delete the only version of a song: this, then the sentence about setlists if it is in any, then the last, with a space between.
versions-confirm-song = Delete this song?
versions-confirm-used =
    { $count ->
        [one] It is in 1 setlist and will be taken out of it, so it will no longer count as played there.
       *[other] It is in { $count } setlists and will be taken out of them, so it will no longer count as played there.
    }
versions-confirm-final = It cannot be undone from here.
versions-merge = Merge another song into this one
versions-merge-which = The song to merge in
versions-merge-choose = Choose a song
versions-fill = Fill in details one is missing (artist, copyright, tempo, time) from the other. Details already there are never changed.
versions-merge-button = Merge as a variant

card-local = Just me
card-local-title = Added on this device only
card-remove = Remove song
card-lyrics = Lyrics
# { $source } is the setlist the song was last played in.
card-from = From { $source }

# What an annotation is about ("on “grace”", "on this line"), and its form.
annotation-label = Annotation
annotation-heading-new = New annotation on { $about }
annotation-heading = Annotation on { $about }
annotation-text-label = Annotation text
annotation-example = e.g. quietly, drop out, repeat 4×
annotation-seen-by = Seen by
annotation-seen-me = Just me
annotation-seen-everyone = Everyone
annotation-hint-cannot-share = Only people who can edit the setlist can share an annotation with everyone.
annotation-hint-shared = Everyone who has this setlist sees it.
annotation-about-song = the whole song
annotation-about-section = this section
annotation-about-line = this line
# { $text } is the word or the section's name.
annotation-about-quoted = “{ $text }”

diff-label = Songs to compare

# A section of a song: its name when it has none, and the buttons that show what it holds.
section-numbered = Section { $number }
section-show-options = Show content options
section-show = Show:
section-all = All
section-lyrics = Lyrics
section-chords = Chords
section-melody = Melody
section-none = None
# { $what } is one of the five above, { $section } the section's name.
section-show-in = Show { $what } in { $section }
section-melody-shown = Showing the melody
section-melody-has = The lead sheet has the melody for this part
section-expand = Expand section
section-collapse = Collapse section


## Sharing a setlist (a link, or the list of its songs), and what is sent with them

# { $title } is the setlist's name and date.
share-subject = Setlist: { $title }
share-message = Chordless setlist: { $title }. It opens in your browser, no login needed.
# { $url } is where the app is.
share-signature = Sent from Chordless: { $url }
share-heading = Share this setlist
share-mode-link = Link / QR
share-mode-list = Song list
share-list-text = The details and songs as text, with CCLI numbers, to paste into a message.
share-list-label = Song list
share-list-copy = Copy song list
share-list-email = Email song list
# <account> is a link to the Account and Teams page.
# In the share dialog of a setlist in a space that has been moved to Chordless: new links and updates are not available yet.
share-checking = Checking whether it is shared…
# A link to a setlist in a space stored on Chordless: there is nothing to update, it always shows the setlist as it is.
share-server-point-3 = It always shows the setlist as it is now, and is deleted two weeks after the setlist date.
# { $date } is when the link stops working.
share-server-ends = Ends after { $date }. It always shows the setlist as it is now.
share-sign-in = Connect Google Drive on the <account>Account and Teams page</account> to share this setlist by link.
share-link-text = Make a link to this setlist for people outside your Chordless space, whether or not they use Chordless.
share-link-point-1 = They need no account or install, and can keep it on their phone.
share-link-point-2 = They can read it, but not change it.
share-link-point-3 = It updates when you change the setlist, and is deleted two weeks after the setlist date.
share-link-point-4 = Anyone with the link can open it. You can stop sharing at any time.
share-create = Create share link
share-making = Making link…
share-link-label = Share link
share-copy-link = Copy link
share-to = Share to…
share-whatsapp = WhatsApp
share-gmail = Email (Gmail)
share-qr = QR code for the share link
# { $date } is the day after which the link stops working.
share-ends = Ends after { $date }. It updates by itself when you sync; "Update now" does it straight away.
share-update = Update now
share-working = Working…

# The first lines of the song list a person pastes into a message.
songlist-heading = Songs for { $date }
songlist-leader = Worship Leader: { $leader }

# What is said with an invitation to a Team, by the share sheet, WhatsApp or email.
invite-send = Send…
invite-subject = Join { $team } on Chordless
# { $team } is the Team, { $role } the role with its article ("a worship leader").
invite-message-intro = You are invited to join { $team } on Chordless as { $role }.
invite-message-open = Open the link and sign in with your email address or a Google account: it does not have to be { $email }. The link works once, for a week.
# For an admin, whose invite only works with its address
invite-message-admin = Open the link and sign in with { $email }: this invite only works with that address. The link works once, for a week.

    Then sign in with the Google account { $email }; the link works once, for a week.


## Contact, and the usage reports

contact-tell-heading = Tell us
# { $address } is the address the email goes to.
contact-tell-text = A problem, a song that does not look right, or an idea. This starts an email to { $address }, which you send yourself: Chordless keeps no messages.
contact-message = Your message
contact-details-heading = What goes with it
contact-details-text = So we do not have to ask. It is added under your message, and says nothing about your songs.
contact-write = Write the email
contact-copy = Copy the details

## Speed test

# The heading of the page, and of the link to it on the Contact page.
speed-test-page = Speed test
speed-test-heading = Is Chordless slow on this device?
speed-test-intro = This draws made-up songs three different ways and times each one, which shows where the time goes. It takes about a minute. Keep this page open and the screen on, and do not run it during a service: the page is busy while it runs.
# <privacy> is a link to the privacy page, where the reports are turned off.
speed-test-private-on = When it finishes, the timings are sent to us with the app's anonymous usage reports, under your Support ID. The songs are made up, so nothing of yours is in them. You can turn the reports off on the <privacy>privacy page</privacy>, and nothing is sent.
# <privacy> is a link to the privacy page, where the reports are turned on.
speed-test-private-off = Usage reports are off, so nothing is sent from here. The songs are made up, so nothing of yours is in the results: you read them, and send them to us if you choose. You can turn the reports on at the <privacy>privacy page</privacy>.
speed-test-low-power-label = Is Low Power Mode on? (A page cannot tell: it is in Settings, under Battery, and slows the screen down.)
speed-test-low-power-unknown = I do not know
speed-test-low-power-on = Yes, it is on
speed-test-low-power-off = No, it is off
speed-test-note-label = Anything else we should know? (The battery is low, a lot of apps are open, which setlist feels slow.) This is not in the usage reports: it is only in the results you copy or email.
speed-test-start = Start the test
speed-test-again = Run it again
speed-test-stop = Stop
speed-test-starting = Getting ready
# { $done } is the timing under way, of { $total }. { $what } is what is being drawn: a message below.
speed-test-progress = Timing { $done } of { $total }: { $what }
# { $count } is how many songs.
speed-test-what-real = { $count } songs, as Chordless draws them
speed-test-what-lyrics = { $count } songs with no chords
speed-test-what-plain = { $count } songs as plain elements
# { $reason } is what went wrong, as the browser says it.
speed-test-failed = The test could not finish: { $reason }
speed-test-done-heading = The results
# Shown above the results when the timings were sent as usage reports.
speed-test-sent = The timings were sent to us, as anonymous usage reports under your Support ID. You do not have to send anything else.
# Shown above the results when usage reports are off.
speed-test-not-sent = Usage reports are off, so nothing was sent. To send these to us, copy them or write the email.
speed-test-done-text = They have your Support ID and your device's details in them, and nothing about your songs. You can send them to us with a message if you like.
speed-test-copy = Copy the results
speed-test-write = Write the email
speed-test-link-heading = Is it slow?
speed-test-link-text = The speed test times how long songs take to draw on this device, and makes a report you can send us. It takes about a minute.
speed-test-link = Run the speed test

usage-toggle = Send anonymous usage reports from this device
# <code> is the number. { $id } is the support ID.
usage-support-id = Support ID: <code>{ $id }</code>
usage-reset = Reset
# <contact> is a link to the Contact page.
usage-text = If you ask for help, this is how your reports are found. Reset makes a new one. <contact>Contact us</contact> adds it for you.


## Uploading a set of pad sounds

padup-name = Pad set name
padup-name-example = e.g. Warm Pads - Churchfront
padup-save-to = Save to
padup-team = Everyone in the team can use it
padup-file = Zip file of the pads
# { $name } is the file chosen.
padup-selected = Selected: { $name }
padup-uploading-label = Uploading pad set
padup-uploading = Uploading…
padup-upload = Upload pad set


## Joining a Team with an invite link (the rest of the page), a space's people, the tabs, the library's filter and a space's page

join-signed-in = You are signed in.
# <who> is the address they are signed in with.
join-signed-in-as = You are signed in as <who>{ $email }</who>.
join-adds = Joining adds the team's songs and setlists to this device, and keeps them in step with the team's.
join-button = Join the team space
join-different-account = Use a different account
join-bad-link = This link doesn't work
join-bad-link-text = It is missing part of the invite, which can happen if it was cut short. Ask the person who sent it to send it again.
join-invalid = This invite doesn't work
join-joining = Joining…
join-getting = Getting the team's songs and setlists…
join-getting-label = Getting the team's songs and setlists
# { $name } is the Team, { $role } what they are in it ("a worship leader").
join-joined = You have joined { $name }
join-joined-text = The space is on this device, and you are in it as { $role }.
join-not-synced = The team's songs and setlists have not come across yet. Open the space and sync to try again.
join-synced = The team's songs and setlists are here.
join-failed-heading = Couldn't join
# When the Worker says the invite was for another Google account. { $email } is the one they are signed in with.
join-wrong-account-not = This invite was sent to a different Google account, not { $email }. Sign in with the address it was sent to.
join-wrong-account = This invite was sent to a different Google account. Sign in with the address it was sent to.

people-reading = Reading…
people-not-here = This space is not on this device.
people-person-label = Person
people-people-label = People
people-leaders-text = The people who lead this space's setlists. Two spellings of one person are put right by merging one into the other.
# Added after the sentence above, with a space, for someone who may not change them.
people-leaders-read-only = Only worship leaders can change them, and you can change your own name.
people-nobody = Nobody leads a setlist here yet.

filter-label = Spaces to search
filter-spaces = Spaces:

space-back = ← Account and Teams
space-page-missing = That space is not on this device.
# A church's team, on its page: its people, roles and licence are the church's, on the church's page (a link follows).
space-page-church = This team belongs to its church. Its people, their roles and the CCLI licence are on the church's page.
space-page-church-link = Open the church's page

live-leave = Leave live
live-take-over = Take over live here
annotation-shared-title = Shared with everyone
annotation-private-title = Just you
card-last-played = Last played { $when }
card-not-played-here = Not played in this version
leader-email-invalid = That does not look like an email address.
leader-email-theirs = They have that address already.
leader-email-other = { $name } has that address already: merge them to join the two.
add-song-load-failed = Couldn't load the songs. Please try again.
add-song-add-failed = Couldn't add the song.
google-script-offline = Couldn't load Google sign-in. Are you offline?
google-in-use = That Google account is already used by another Chordless account.
google-sign-in-expired = Chordless's access to your Google Drive has expired. Reconnect Google Drive.
picker-offline = Couldn't load Google's folder picker. Are you offline?
picker-team-title = Choose where to keep the Team's songs
setlist-not-found = That setlist is not on this device.

# D1 space data sync
space-data-conflict = Another device changed the same details. Your later changes were kept.
space-data-refused = This change is saved on this device, but could not be synced.
library-song-sync-conflict = A song changed on another device. This device's copy is safe; resolve the difference before syncing again.
space-data-get-song = Get this song
space-data-missing-song = The chart is not on this device yet.

# Church administration
church-console-title = Organisations and churches
church-console-open = Register an organisation or church
church-console-setup = Your church's teams share setlists and songs.
church-no-song-copy = Songs cannot be copied between a church and another library.
share-no-song-copy = A song in a shared setlist stays in that setlist: it cannot be added to a library.
title-churches = Organisations and churches - Chordless
church-console-signin = Sign in on the Account page, then open this link again.
church-console-loading = Loading churches…
church-console-new = Register an organisation or church
church-console-name = Church name
church-console-country = Country
church-console-city = City or town
church-console-postcode = Postcode or ZIP (optional)
church-console-licence = CCLI licence number (optional)
church-console-licence-missing = Add your CCLI licence number when you have it.
church-console-matches = A church with this number may already exist: { $names }. Ask an admin for an invitation if it is yours. The number may be incorrect. Create this church anyway?
church-console-create = Register
church-console-save = Save changes
church-console-select = Choose a church
church-console-teams = Teams
church-console-country-choose = Choose a country
church-console-drive-teams = Teams on Google Drive
church-console-drive-text = A team that is still kept in Google Drive can be moved into this church. Its members join the church, and its songs and setlists move from Google Drive to Chordless as each person opens the app, so everyone needs the latest version first.
# { $church } is the name of the church the team would be moved into.
church-console-adopt = Move into { $church }
# { $team } is the team, { $church } the church. Asked before the move.
church-console-confirm-adopt = Move { $team } into { $church }? Its members become members of the church, and its songs and setlists move from Google Drive to Chordless on each device as it opens the app. Everyone needs the latest version first, and Google Drive is not used for this team again.
# { $team } is the team that was moved into the church.
church-console-adopted = { $team } has moved into the church. Each device sets it up when its app opens.
church-console-team-name = New team name
church-console-team-add = Add team
church-console-archive = Archive
church-console-restore = Restore
church-console-delete = Delete
church-console-team-people = People on this team
church-console-team-person-add = Add a person…
church-console-team-person-remove = Remove
church-console-members = Members
church-console-remove = Remove
church-console-invite = Invite someone
church-console-email = Email address
church-console-role = Role
church-console-invite-team = Team
church-console-invite-create = Create invitation
church-console-invite-copy = Copy invitation link
church-console-invite-copied = Invitation link copied.
church-console-join = Join this church
church-console-join-button = Accept invitation
church-console-joined = You have joined the church.
church-console-failed = Could not complete that action.
church-console-confirm-heading = Please confirm
church-console-confirm-delete = Delete { $name } for good? Its setlists are deleted with it, and this cannot be undone. The church's songs are kept.
church-console-confirm-archive = Archive { $name }? Its setlist history will be kept.
church-console-confirm-remove = Remove { $name } from the church?
church-console-confirm-role = Change this person's role?
church-console-confirm = Confirm
church-console-admin = Admin
church-console-writer = Worship leader
church-console-reader = Church member
`
