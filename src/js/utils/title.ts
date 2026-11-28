/** A song's title as titles are compared: lower case, without punctuation or spaces */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, '') // Remove all whitespace
    .trim()
}
