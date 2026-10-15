/**
 * The error of a failed IndexedDB transaction, for a `tx.onerror` handler. The failure is the
 * request's (e.g. a ConstraintError for a duplicate key): the event comes up from the request,
 * and `tx.error` is still null while it is reported, so rejecting with that gives a bare null.
 */
export function transactionError(event: Event, tx: IDBTransaction): DOMException | Error | null {
  const request = event.target as IDBRequest | null
  return request?.error ?? tx.error
}

/** The result of an IndexedDB request, as a promise */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * A promise for the end of a transaction: it resolves with `value` once the changes are
 * committed, or rejects with why the transaction failed
 */
export function transactionDone<T = void>(tx: IDBTransaction, value?: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    tx.oncomplete = () => resolve(value as T)
    tx.onerror = event => reject(transactionError(event, tx))
  })
}
