/**
 * Does what the app keeps on this device survive from one launch to the next? A Safari "web app"
 * (File, Add to Dock) was reported to open as a first use every time: its sign-in, songs and
 * settings gone. Nothing in the page can say which store was cleared, or when, so each launch
 * leaves a small marker in localStorage and in an IndexedDB database of its own, and reads the
 * ones the last launch left. What it found is shown on the About page and, with reports on, sent
 * as one span (docs/OBSERVABILITY.md, `chordless.storage.launch`).
 *
 * The marker is a count and two times, never anything of the person's. It is its own database
 * (not one of the app's), so that it cannot upgrade or damage the data it is checking on.
 */

/** What was found in a store when the app started */
export type Survival =
  /** The last launch's marker was there */
  | 'kept'
  /** The store works, and held no marker: a first launch, or the store was cleared */
  | 'new'
  /** The store could not be read (blocked, or the browser has none) */
  | 'unavailable'

/** What a launch leaves, and the next one reads */
interface Marker {
  /** ISO time of the first launch this store knows of */
  first: string
  /** ISO time of the last launch */
  last: string
  /** How many launches this store has seen */
  launches: number
}

export interface LaunchReport {
  localStorage: Survival
  indexedDb: Survival
  /** This launch's number, counting the ones a kept store remembers (1 when neither kept any) */
  launches: number
  /** ISO time of the first launch any kept store remembers (now, when none did) */
  firstSeen: string
  /** ISO time of the launch before this one, if a kept store remembers it */
  previous: string | null
  /** Whether the browser says it will not clear this app's data to make room, if it says */
  persisted: boolean | null
  /** Whether a service worker controls this page: what lets it open offline */
  controlled: boolean
  /** How many of the browser's caches (the saved copy of the app) are there */
  caches: number | null
}

const LOCAL_KEY = 'chordless:launch'
const DB_NAME = 'chordless-launch'
const STORE = 'marker'
const RECORD = 'current'

function parse(text: string | null | undefined): Marker | null {
  if (!text) return null
  try {
    const value = JSON.parse(text) as Partial<Marker> | null
    if (
      value &&
      typeof value.first === 'string' &&
      typeof value.last === 'string' &&
      Number.isInteger(value.launches)
    ) {
      return value as Marker
    }
  } catch {
    // (damaged: it counts as no marker)
  }
  return null
}

/** The marker in localStorage: `undefined` where it cannot be read, `null` where there is none */
function readLocal(storage: Pick<Storage, 'getItem'>): Marker | null | undefined {
  try {
    return parse(storage.getItem(LOCAL_KEY))
  } catch {
    return undefined
  }
}

function writeLocal(storage: Pick<Storage, 'setItem'>, marker: Marker): void {
  try {
    storage.setItem(LOCAL_KEY, JSON.stringify(marker))
  } catch {
    // (blocked, or full: the next launch finds none, which is what it reports)
  }
}

/** The marker in IndexedDB: `undefined` where it cannot be read, `null` where there is none */
function readDatabase(factory: IDBFactory): Promise<Marker | null | undefined> {
  return new Promise(resolve => {
    try {
      const request = factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onerror = () => resolve(undefined)
      request.onblocked = () => resolve(undefined)
      request.onsuccess = () => {
        const db = request.result
        try {
          const get = db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD)
          get.onsuccess = () => {
            db.close()
            resolve(parse(typeof get.result === 'string' ? get.result : null))
          }
          get.onerror = () => {
            db.close()
            resolve(undefined)
          }
        } catch {
          db.close()
          resolve(undefined)
        }
      }
    } catch {
      resolve(undefined)
    }
  })
}

function writeDatabase(factory: IDBFactory, marker: Marker): Promise<void> {
  return new Promise(resolve => {
    try {
      const request = factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
      request.onsuccess = () => {
        const db = request.result
        try {
          const tx = db.transaction(STORE, 'readwrite')
          tx.objectStore(STORE).put(JSON.stringify(marker), RECORD)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = tx.onabort = () => {
            db.close()
            resolve()
          }
        } catch {
          db.close()
          resolve()
        }
      }
    } catch {
      resolve()
    }
  })
}

/** What a test replaces: the stores and the browser's answers */
export interface SurvivalEnvironment {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  indexedDB: IDBFactory | null
  now: () => Date
  persisted: () => Promise<boolean | null>
  controlled: () => boolean
  cacheCount: () => Promise<number | null>
}

const here = (): SurvivalEnvironment => ({
  storage: (() => {
    try {
      return localStorage
    } catch {
      return null
    }
  })(),
  indexedDB: typeof indexedDB === 'undefined' ? null : indexedDB,
  now: () => new Date(),
  persisted: async () => {
    try {
      return (await navigator.storage?.persisted?.()) ?? null
    } catch {
      return null
    }
  },
  controlled: () => !!navigator.serviceWorker?.controller,
  cacheCount: async () => {
    try {
      return typeof caches === 'undefined' ? null : (await caches.keys()).length
    } catch {
      return null
    }
  },
})

const survival = (marker: Marker | null | undefined): Survival =>
  marker === undefined ? 'unavailable' : marker === null ? 'new' : 'kept'

/** Read what the last launch left, and leave this launch's marker (once a launch; see `launchReport`) */
export async function checkLaunch(env: SurvivalEnvironment = here()): Promise<LaunchReport> {
  const local = env.storage ? readLocal(env.storage) : undefined
  const database = env.indexedDB ? await readDatabase(env.indexedDB) : undefined
  const remembered = [local, database].filter((marker): marker is Marker => !!marker)
  // The stores can disagree (one was cleared): the one that remembers more is the truer count
  const best = remembered.reduce<Marker | null>(
    (most, marker) => (!most || marker.launches > most.launches ? marker : most),
    null
  )
  const now = env.now().toISOString()
  const next: Marker = {
    first: [...remembered.map(marker => marker.first), now].sort()[0],
    last: now,
    launches: (best?.launches ?? 0) + 1,
  }
  if (env.storage) writeLocal(env.storage, next)
  if (env.indexedDB) await writeDatabase(env.indexedDB, next)
  const [persisted, caches] = await Promise.all([env.persisted(), env.cacheCount()])
  return {
    localStorage: survival(local),
    indexedDb: survival(database),
    launches: next.launches,
    firstSeen: next.first,
    previous: best?.last ?? null,
    persisted,
    controlled: env.controlled(),
    caches,
  }
}

let launch: Promise<LaunchReport> | null = null

/**
 * This launch's report: the check is made once for a page, however many ask (the start-up, and the
 * About page), as a second run would find the first's marker and call the launch kept.
 */
export function launchReport(): Promise<LaunchReport> {
  launch ??= checkLaunch()
  return launch
}
