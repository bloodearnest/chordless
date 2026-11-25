/**
 * A library's pad sets, through the Worker (worker/src/library-pads.ts): a moved Personal space's, kept in R2 rather
 * than in a Drive folder (docs/CENTRAL_STORAGE.md, step 6). The same shapes as a team space's (`team-storage.ts`),
 * under the library's own path. A set's ref is its id, the same on every device.
 */
import { callWorker, TeamError, type WorkerConnection } from '../worker-call.ts'
import type { PadFileEntry, PadSetEntry, PadStorage } from './types.ts'

export class LibraryPads implements PadStorage {
  #connection: WorkerConnection
  #base: string

  constructor(connection: WorkerConnection, libraryId: string) {
    this.#connection = connection
    this.#base = `/api/libraries/${encodeURIComponent(libraryId)}/pads`
  }

  listSets(): Promise<PadSetEntry[]> {
    return this.#json({ path: this.#base })
  }

  async ensureSet(name: string): Promise<string> {
    const { ref } = await this.#json<{ ref: string }>({
      method: 'POST',
      path: this.#base,
      body: { name },
    })
    return ref
  }

  async listFiles(setRef: string): Promise<PadFileEntry[]> {
    try {
      return await this.#json({ path: `${this.#base}/${encodeURIComponent(setRef)}/files` })
    } catch (error) {
      // (a set that is not there has no files)
      if (error instanceof TeamError && error.status === 404) return []
      throw error
    }
  }

  async addFile(setRef: string, padKey: string, audio: Blob): Promise<void> {
    await callWorker(
      {
        method: 'PUT',
        path: `${this.#base}/${encodeURIComponent(setRef)}/files/${encodeURIComponent(padKey)}`,
        body: new Blob([audio], { type: 'audio/mpeg' }),
      },
      this.#connection
    )
  }

  async trashFiles(setRef: string): Promise<void> {
    await callWorker(
      { method: 'POST', path: `${this.#base}/${encodeURIComponent(setRef)}/trash` },
      this.#connection
    )
  }

  async read(fileRef: string): Promise<ArrayBuffer> {
    return (await this.#file(fileRef)).arrayBuffer()
  }

  async readStream(fileRef: string): Promise<ReadableStream<Uint8Array>> {
    // (an answer with audio always has a body)
    return (await this.#file(fileRef)).body as ReadableStream<Uint8Array>
  }

  #file(fileRef: string): Promise<Response> {
    return callWorker(
      { path: `${this.#base}/files/${encodeURIComponent(fileRef)}` },
      this.#connection
    )
  }

  async #json<T>(call: Parameters<typeof callWorker>[0]): Promise<T> {
    return (await callWorker(call, this.#connection)).json() as Promise<T>
  }
}
