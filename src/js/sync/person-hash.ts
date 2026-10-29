import type { Person } from '../data-types.ts'
import { hashText } from '../utils/hash.ts'

/**
 * What a person keeps of its file in storage, and whether it has changes that are not there.
 * Pure functions, with no other imports, so the database can use them too (as setlist-hash.ts).
 */

/** What a person keeps of its file: the link, and what was last synced with it */
export const PERSON_SYNC_FIELDS = [
  'fileRef',
  'fileModified',
  'fileRev',
  'lastSyncedAt',
  'syncedContentHash',
] as const

type SyncField = (typeof PERSON_SYNC_FIELDS)[number]

/** A person without this device's sync state: what is stored in the space's file */
export function personContent(person: Person): Omit<Person, SyncField> {
  const content: Partial<Person> = { ...person }
  for (const field of PERSON_SYNC_FIELDS) delete content[field]
  return content as Omit<Person, SyncField>
}

/** Hash of a person's content, ignoring sync state and when it was last saved */
export function personContentHash(person: Person): string {
  const { modifiedDate: _modifiedDate, ...content } = personContent(person)
  // (the order of keys and of emails must not matter)
  return hashText(
    JSON.stringify([
      content.id,
      content.name,
      [...content.emails].sort(),
      content.teamMember ?? null,
      content.mergedInto ?? null,
    ])
  )
}

/** Whether a person has changes that are not in storage: never uploaded, or edited since */
export function personHasLocalChanges(person: Person): boolean {
  if (!person.fileRef) return true
  return personContentHash(person) !== person.syncedContentHash
}
