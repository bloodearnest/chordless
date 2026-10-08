/**
 * In-memory fake of the parts of the Google Drive v3 REST API that Chordless uses.
 *
 * installFakeDrive() replaces globalThis.fetch for googleapis.com requests (others
 * pass through) and sets drive-api.js's access token provider, so the real
 * drive-api.js / drive-sync.js code runs unchanged against it.
 *
 * Fidelity notes. It models the Drive behaviours sync relies on:
 * - appProperties (app-private) and properties (public) are separate; queries
 *   `properties has {...}` and `appProperties has {...}` only search their own.
 * - Responses only include requested `fields`. Without `fields`, file resources
 *   are Drive's defaults (kind, id, name, mimeType), so e.g. a create response
 *   has no modifiedTime, as with the real API.
 * - Lists are paginated (default 100, max maxPageSize); nextPageToken is only
 *   returned when `fields` requests it.
 * - modifiedTime comes from the server clock (Date.now() + clockOffsetMs), not
 *   the client's, and changes on content updates.
 * - Metadata-only PATCHes don't change modifiedTime. ASSUMPTION: verify against
 *   real Drive in the integration tests.
 *
 * Anything it doesn't model (an unknown query clause, orderBy, endpoint) throws
 * rather than guessing, so a test can't silently pass against wrong behaviour.
 */

import { setAccessTokenProvider } from '../public/js/drive-api.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DEFAULT_FILE_FIELDS = ['kind', 'id', 'name', 'mimeType']
const VALID_TOKEN = 'fake-drive-token'

export class FakeDriveError extends Error {}

export class FakeDrive {
  constructor() {
    /** @type {Map<string, object>} id -> file record (content kept alongside metadata) */
    this.files = new Map()
    /** Every request handled, for assertions: { method, path, params, body } */
    this.requests = []
    /** Server clock skew relative to the test's (client's) clock, in ms */
    this.clockOffsetMs = 0
    /** Largest page a list request returns (real Drive: 1000) */
    this.maxPageSize = 1000
    this._nextId = 1
    this._failures = []
    /** FakeDriveErrors raised while handling requests. The app may swallow
     * fetch errors (e.g. batchUploadFiles), so tests assert this stays empty. */
    this.errors = []
  }

  // ---------- test helpers ----------

  now() {
    return new Date(Date.now() + this.clockOffsetMs).toISOString()
  }

  /**
   * Make matching requests fail.
   * @param {object} spec
   * @param {string} [spec.method] - e.g. 'PATCH'
   * @param {RegExp} [spec.path] - matched against the decoded URL path + query
   * @param {number} [spec.status=500] - HTTP status to return
   * @param {boolean} [spec.network=false] - reject the fetch like a dropped connection
   * @param {number} [spec.times=1] - how many matching requests fail
   * @param {number} [spec.skip=0] - let this many matching requests succeed first
   */
  failRequests({ method, path, status = 500, network = false, times = 1, skip = 0 } = {}) {
    this._failures.push({ method, path, status, network, times, skip })
  }

  /** Files that aren't folders, optionally filtered by a predicate on the record */
  listFiles(predicate = () => true) {
    return [...this.files.values()].filter(f => f.mimeType !== FOLDER_MIME && predicate(f))
  }

  /** Find a file by path of names from the root, e.g. ['Chordless', 'Org', 'setlists'] */
  findByPath(names) {
    let parent = null
    let found = null
    for (const name of names) {
      found = [...this.files.values()].find(
        f => f.name === name && !f.trashed && (parent ? f.parents.includes(parent) : true)
      )
      if (!found) return null
      parent = found.id
    }
    return found
  }

  /** Simulate an edit made elsewhere (another device, or the Drive UI) */
  editContent(fileId, content) {
    const file = this._get(fileId)
    file.content = content
    file.modifiedTime = this.now()
    file.version++
  }

  // ---------- fetch handling ----------

  async handle(input, init = {}) {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const path = url.pathname
    const params = url.searchParams
    const method = request.method

    const failure = this._takeFailure(method, decodeURIComponent(path + url.search))
    if (failure?.network) {
      this.requests.push({ method, path, params, failed: 'network' })
      throw new TypeError('Failed to fetch (fake network failure)')
    }
    if (failure) {
      this.requests.push({ method, path, params, failed: failure.status })
      return json(
        { error: { code: failure.status, message: `Injected ${failure.status}` } },
        failure.status
      )
    }

    if (request.headers.get('Authorization') !== `Bearer ${VALID_TOKEN}`) {
      return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401)
    }

    const body = method === 'GET' || method === 'HEAD' ? '' : await request.text()
    this.requests.push({ method, path, params, body })

    const fileMatch = path.match(/^\/drive\/v3\/files\/([^/]+)$/)
    const uploadMatch = path.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)

    if (path === '/drive/v3/about' && method === 'GET') {
      return json({ user: { displayName: 'Fake User', emailAddress: 'fake@example.com' } })
    }
    if (path === '/drive/v3/files' && method === 'GET') {
      return this._list(params)
    }
    if (path === '/drive/v3/files' && method === 'POST') {
      return this._create(JSON.parse(body || '{}'), '', params)
    }
    if (fileMatch && method === 'GET') {
      const file = this._getOr404(fileMatch[1])
      if (file instanceof Response) return file
      if (params.get('alt') === 'media') {
        return new Response(file.content, { headers: { 'Content-Type': file.mimeType } })
      }
      return json(this._project(file, params.get('fields')))
    }
    if (fileMatch && method === 'PATCH') {
      const file = this._getOr404(fileMatch[1])
      if (file instanceof Response) return file
      this._applyMetadata(file, JSON.parse(body || '{}'))
      return json(this._project(file, params.get('fields')))
    }
    if (fileMatch && method === 'DELETE') {
      const file = this._getOr404(fileMatch[1])
      if (file instanceof Response) return file
      this.files.delete(file.id)
      return new Response(null, { status: 204 })
    }
    if (path === '/upload/drive/v3/files' && method === 'POST') {
      if (params.get('uploadType') !== 'multipart')
        this._unsupported(`uploadType=${params.get('uploadType')}`)
      const { metadata, content } = parseMultipart(request.headers.get('Content-Type'), body)
      return this._create(metadata, content, params)
    }
    if (uploadMatch && method === 'PATCH') {
      if (params.get('uploadType') !== 'media')
        this._unsupported(`uploadType=${params.get('uploadType')}`)
      const file = this._getOr404(uploadMatch[1])
      if (file instanceof Response) return file
      file.content = body
      file.modifiedTime = this.now()
      file.version++
      return json(this._project(file, params.get('fields')))
    }

    this._unsupported(`${method} ${path}`)
  }

  _takeFailure(method, pathAndQuery) {
    for (const failure of this._failures) {
      if (failure.times <= 0) continue
      if (failure.method && failure.method !== method) continue
      if (failure.path && !failure.path.test(pathAndQuery)) continue
      if (failure.skip > 0) {
        failure.skip--
        continue
      }
      failure.times--
      return failure
    }
    return null
  }

  _create(metadata, content, params) {
    const now = this.now()
    const file = {
      kind: 'drive#file',
      id: `fake-${this._nextId++}`,
      name: metadata.name ?? 'Untitled',
      mimeType: metadata.mimeType ?? 'application/octet-stream',
      parents: metadata.parents ?? ['root'],
      appProperties: { ...metadata.appProperties },
      properties: { ...metadata.properties },
      description: metadata.description,
      trashed: false,
      createdTime: now,
      modifiedTime: now,
      version: 1,
      content,
    }
    this.files.set(file.id, file)
    return json(this._project(file, params.get('fields')))
  }

  _applyMetadata(file, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'appProperties' || key === 'properties') {
        // Drive merges property maps; a null value removes the key
        for (const [k, v] of Object.entries(value ?? {})) {
          if (v === null) delete file[key][k]
          else file[key][k] = String(v)
        }
      } else if (['name', 'description', 'trashed', 'mimeType'].includes(key)) {
        file[key] = value
      } else {
        this._unsupported(`PATCH of metadata field "${key}"`)
      }
    }
  }

  _list(params) {
    const q = params.get('q')
    let files = [...this.files.values()]
    if (q) {
      const matches = compileQuery(q)
      files = files.filter(matches)
    }

    const orderBy = params.get('orderBy')
    if (orderBy === 'modifiedTime desc') {
      files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))
    } else if (orderBy) {
      this._unsupported(`orderBy=${orderBy}`)
    }

    // Pagination: Drive's default pageSize is 100, capped at 1000 (maxPageSize,
    // lowerable in tests). nextPageToken is only returned when fields asks for it.
    const pageSize = Math.min(Number(params.get('pageSize')) || 100, this.maxPageSize)
    const start = Number(params.get('pageToken') || 0)
    const page = files.slice(start, start + pageSize)
    const more = start + pageSize < files.length

    const fieldsParam = params.get('fields')
    const fileFields = fieldsParam?.match(/files\(([^)]*)\)/)?.[1]
    const result = { kind: 'drive#fileList', files: page.map(f => this._project(f, fileFields)) }
    if (more && (!fieldsParam || /\bnextPageToken\b/.test(fieldsParam))) {
      result.nextPageToken = String(start + pageSize)
    }
    return json(result)
  }

  _project(file, fields) {
    const names = fields ? fields.split(',').map(s => s.trim()) : DEFAULT_FILE_FIELDS
    const out = {}
    for (const name of names) {
      if (name === 'size') out.size = String(file.content?.length ?? 0)
      else if (file[name] !== undefined && name !== 'content')
        out[name] = structuredClone(file[name])
    }
    return out
  }

  _get(id) {
    const file = this.files.get(id)
    if (!file) throw new FakeDriveError(`No such file: ${id}`)
    return file
  }

  _getOr404(id) {
    return (
      this.files.get(id) ?? json({ error: { code: 404, message: `File not found: ${id}` } }, 404)
    )
  }

  _unsupported(what) {
    throw new FakeDriveError(`FakeDrive does not support ${what}`)
  }
}

// ---------- query language (only the forms Chordless uses) ----------

/** Split on top-level " and ", ignoring ones inside { } and quotes */
function splitAnd(q) {
  const parts = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < q.length; i++) {
    const ch = q[i]
    if (ch === "'" && q[i - 1] !== '\\') quoted = !quoted
    if (quoted) continue
    if (ch === '{') depth++
    if (ch === '}') depth--
    if (depth === 0 && q.startsWith(' and ', i)) {
      parts.push(q.slice(start, i))
      start = i + 5
      i += 4
    }
  }
  parts.push(q.slice(start))
  return parts.map(p => p.trim())
}

const unquote = s => s.replace(/\\'/g, "'")

function compileClause(clause) {
  let m
  if ((m = clause.match(/^'([^']+)' in parents$/))) {
    const parent = m[1]
    return f => f.parents.includes(parent)
  }
  if ((m = clause.match(/^trashed\s*=\s*(true|false)$/))) {
    const trashed = m[1] === 'true'
    return f => f.trashed === trashed
  }
  if ((m = clause.match(/^(name|mimeType)\s*=\s*'((?:[^'\\]|\\.)*)'$/))) {
    const [, field, value] = m
    return f => f[field] === unquote(value)
  }
  if ((m = clause.match(/^name contains '((?:[^'\\]|\\.)*)'$/))) {
    const value = unquote(m[1])
    return f => f.name.includes(value)
  }
  if (
    (m = clause.match(/^(appProperties|properties) has \{ key='([^']*)' and value='([^']*)' \}$/))
  ) {
    const [, field, key, value] = m
    return f => f[field][key] === value
  }
  throw new FakeDriveError(`FakeDrive cannot evaluate query clause: ${clause}`)
}

function compileQuery(q) {
  if (/\bor\b|\(|\bnot\b/.test(q.replace(/'(?:[^'\\]|\\.)*'/g, "''"))) {
    throw new FakeDriveError(`FakeDrive only supports "and" queries: ${q}`)
  }
  const predicates = splitAnd(q).map(compileClause)
  return f => predicates.every(p => p(f))
}

// ---------- multipart/related parsing ----------

function parseMultipart(contentType, body) {
  const boundary = contentType?.match(/boundary=("?)([^";]+)\1/)?.[2]
  if (!boundary) throw new FakeDriveError(`No multipart boundary in: ${contentType}`)
  const parts = body
    .split(`--${boundary}`)
    .map(p => p.replace(/^\r\n/, ''))
    .filter(p => p && p !== '--' && !p.startsWith('--'))
    .map(p => {
      const split = p.indexOf('\r\n\r\n')
      return { headers: p.slice(0, split), body: p.slice(split + 4).replace(/\r\n$/, '') }
    })
  if (parts.length !== 2)
    throw new FakeDriveError(`Expected 2 multipart parts, got ${parts.length}`)
  return { metadata: JSON.parse(parts[0].body), content: parts[1].body }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------- install ----------

/**
 * Route googleapis.com fetches to a new FakeDrive and give drive-api.js a valid token.
 * Call the returned drive's uninstall() in afterEach.
 */
export function installFakeDrive() {
  const drive = new FakeDrive()
  const realFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (new URL(url, location.href).hostname === 'www.googleapis.com') {
      return drive.handle(input, init).catch(error => {
        if (error instanceof FakeDriveError) drive.errors.push(error)
        throw error
      })
    }
    return realFetch(input, init)
  }
  setAccessTokenProvider(async () => VALID_TOKEN)
  drive.uninstall = () => {
    globalThis.fetch = realFetch
    setAccessTokenProvider(null)
  }
  return drive
}
