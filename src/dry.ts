/**
 * Dry-run fetch source: the repo's mock Saizeriya server
 * (packages/server), the same one the tests run against. In dry mode the
 * client core talks to this in-isolate mock instead of the real official
 * system, so no real order is ever placed. Unknown QR URLs resolve to the
 * mock's demo table, like they do in the mock's own pages.
 *
 * The mock keeps table state in memory, but a Worker request may land on
 * a different isolate than the previous one. To keep a dry session
 * continuous anyway, the mock table state is serialized into the
 * session snapshot (`_dryTableState`) after every call and restored
 * before the next one — the snapshot is the one thing the caller always
 * carries across requests.
 */
import mockServer, { mockServerInstance, type TableState } from './mock-server/main'

type FetchSource = (request: Request) => Promise<Response> | Response

export const dryFetch: FetchSource = (request) => mockServer.fetch(request)

interface SnapshotLike {
  state?: { sessionId?: string; nextId?: string }
  _dryTableState?: TableState
}

export const restoreDryTable = (snapshot: unknown): void => {
  const snap = snapshot as SnapshotLike | undefined
  if (snap?.state && snap._dryTableState) {
    mockServerInstance.restoreSession(snap._dryTableState, snap.state.nextId ?? '')
  }
}

export const captureDryTable = (state: {
  sessionId?: string
  nextId?: string
}): TableState | undefined => {
  // The page URL id always maps to the table the last call used. The
  // client state's sessionId only exists after people registration, so
  // it is the fallback.
  if (state.nextId) {
    const byUrlId = mockServerInstance.findTableByUrlId(state.nextId)?.getState()
    if (byUrlId) {
      return byUrlId
    }
  }
  return state.sessionId
    ? mockServerInstance.findTableBySessionId(state.sessionId)?.getState()
    : undefined
}

/** Embed the current mock table state into a response payload's snapshot. */
export const captureDryIntoPayload = (payload: unknown): unknown => {
  if (!payload || typeof payload !== 'object') {
    return payload
  }
  const record = payload as Record<string, unknown>
  for (const key of ['officialSession', 'snapshot']) {
    const snap = record[key] as SnapshotLike | undefined
    if (snap?.state) {
      const tableState = captureDryTable(snap.state)
      if (tableState) {
        record[key] = { ...snap, _dryTableState: tableState }
      }
    }
  }
  return payload
}

/** Restore the mock table from the snapshot in a request body, if any. */
export const restoreDryFromRequest = async (request: Request): Promise<void> => {
  try {
    const body = (await request.clone().json()) as Record<string, unknown>
    restoreDryTable(body?.officialSession ?? body?.snapshot)
  } catch {
    // No JSON body / no snapshot: nothing to restore.
  }
}

/** Post-process a JSON response so its snapshot carries the table state. */
export const captureDryIntoResponse = async (response: Response): Promise<Response> => {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return response
  }
  const payload = await response
    .clone()
    .json()
    .catch(() => undefined)
  if (!payload || typeof payload !== 'object') {
    return response
  }
  const before = JSON.stringify(payload)
  captureDryIntoPayload(payload)
  if (JSON.stringify(payload) === before) {
    return response
  }
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(JSON.stringify(payload), { status: response.status, headers })
}
