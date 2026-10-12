/**
 * The error of a failed IndexedDB transaction, for a `tx.onerror` handler. The failure is the
 * request's (e.g. a ConstraintError for a duplicate key): the event comes up from the request,
 * and `tx.error` is still null while it is reported, so rejecting with that gives a bare null.
 */
export function transactionError(event: Event, tx: IDBTransaction): DOMException | Error | null {
  const request = event.target as IDBRequest | null
  return request?.error ?? tx.error
}
