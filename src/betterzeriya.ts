/**
 * Betterzeriya (apps/betterzeriya) API, ported from
 * apps/betterzeriya-server (server/svelte-api/handlers.ts +
 * server/lib/official-client.ts + server/lib/session-model-store.ts).
 *
 * The Svelte frontend is stateless against this API: it keeps the
 * `officialSession` snapshot in localStorage and posts it back with every
 * request. The snapshot carries the client state and the official-site
 * cookies, so possession of the snapshot is the capability — the same
 * trust model as the upstream server (no extra auth here).
 *
 * Room model (device names + who ordered what) is kept per roomHash —
 * the SHA-256 of the table QR URL — in the SESSIONS KV when bound, with
 * the same in-memory fallback as the CLI sessions.
 */
import { createClient, type ClientState } from './lib/client/client'
import type { KVNamespaceLike } from './index'

type CookieEntry = [string, string]
type FetchSource = (request: Request) => Promise<Response> | Response

export interface OfficialSessionSnapshot {
  id: string
  state: ClientState
  cookies: CookieEntry[]
  roomHash?: string
  mode?: 'fetch' | 'browser'
  createdAt: number
  updatedAt: number
}

export interface RoomEnv {
  SESSIONS?: KVNamespaceLike
}

/* ------------------------------------------------------------ hashing */

const textEncoder = new TextEncoder()
const bytesToHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
export const sha256Hex = async (value: string) =>
  bytesToHex(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)))
export const hashInitialURL = sha256Hex

/* ---------------------------------------------------------- cookie jar */

const cookieHeader = (cookies: Map<string, string>) =>
  [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')

const storeSetCookie = (cookies: Map<string, string>, response: Response) => {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) {
    return
  }
  for (const cookie of setCookie.split(/,(?=\s*[^;,;\s]+=)/)) {
    const [pair] = cookie.split(';')
    const separator = pair?.indexOf('=') ?? -1
    if (pair && separator > 0) {
      cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
    }
  }
}

const createCookieFetch = (initialCookies: CookieEntry[] = [], baseFetch?: FetchSource) => {
  const cookies = new Map<string, string>(initialCookies)
  const fetchSource: FetchSource = async (request) => {
    const headers = new Headers(request.headers)
    const currentCookies = cookieHeader(cookies)
    if (currentCookies) {
      headers.set('cookie', currentCookies)
    }
    const response = baseFetch
      ? await baseFetch(new Request(request, { headers }))
      : await fetch(new Request(request, { headers }))
    storeSetCookie(cookies, response)
    return response
  }
  return {
    fetchSource,
    getCookies: () => [...cookies.entries()] as CookieEntry[],
  }
}

/* ------------------------------------------------------------ snapshot */

export const parseOfficialSessionSnapshot = (
  value: unknown,
): OfficialSessionSnapshot | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const snapshot = value as OfficialSessionSnapshot
  if (!snapshot.id || !snapshot.state?.baseURL || !Array.isArray(snapshot.cookies)) {
    return undefined
  }
  return snapshot
}

const createSnapshot = (
  id: string,
  state: ClientState,
  cookies: CookieEntry[],
  createdAt: number,
  roomHash?: string,
): OfficialSessionSnapshot => ({
  id,
  state,
  cookies,
  ...(roomHash ? { roomHash } : {}),
  mode: 'fetch',
  createdAt,
  updatedAt: Date.now(),
})

export const serializeState = (state: ClientState) => ({ ...state, baseURL: undefined })

type Client = Awaited<ReturnType<typeof createClient>>

const createClientFromSnapshot = async (
  id: string,
  snapshot: OfficialSessionSnapshot | undefined,
  baseFetch?: FetchSource,
): Promise<{ client: Client; getSnapshot: () => OfficialSessionSnapshot }> => {
  if (snapshot?.id !== id) {
    throw new Error('Session snapshot not found')
  }
  const jar = createCookieFetch(snapshot.cookies, baseFetch)
  const client = await createClient({ initialState: snapshot.state, fetchSource: jar.fetchSource })
  return {
    client,
    getSnapshot: () =>
      createSnapshot(
        id,
        client.getState(),
        jar.getCookies(),
        snapshot.createdAt,
        snapshot.roomHash,
      ),
  }
}

/* ----------------------------------------------------------- room store */

export interface OrderAttributionLine {
  code: string
  count: number
  name?: string
}

interface RoomRecord {
  devices: Record<string, { name?: string; updatedAt: string }>
  orders: { tokenHash: string; orderedAt: string; lines: OrderAttributionLine[] }[]
}

const ROOM_TTL_MS = 24 * 60 * 60 * 1000
const roomMemory = new Map<string, RoomRecord>()

const roomKey = (roomHash: string) => `room:${roomHash}`

const loadRoom = async (env: RoomEnv, roomHash: string): Promise<RoomRecord> => {
  if (env.SESSIONS) {
    const raw = await env.SESSIONS.get(roomKey(roomHash))
    if (raw) {
      return JSON.parse(raw) as RoomRecord
    }
  }
  return roomMemory.get(roomHash) ?? { devices: {}, orders: [] }
}

const saveRoom = async (env: RoomEnv, roomHash: string, room: RoomRecord) => {
  const cutoff = Date.now() - ROOM_TTL_MS
  room.orders = room.orders.filter((order) => Date.parse(order.orderedAt) > cutoff)
  if (env.SESSIONS) {
    await env.SESSIONS.put(roomKey(roomHash), JSON.stringify(room))
  } else {
    roomMemory.set(roomHash, room)
  }
}

export const normalizeRoomHash = (hash: unknown) => {
  const trimmed = String(hash ?? '')
    .trim()
    .toLowerCase()
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : undefined
}

export const normalizeDeviceToken = (token: unknown) => {
  const trimmed = String(token ?? '').trim()
  return /^[A-Za-z0-9_-]{32,180}$/.test(trimmed) ? trimmed : undefined
}

const normalizeUserName = (name: unknown) => {
  const trimmed = String(name ?? '').trim()
  return trimmed ? trimmed.slice(0, 40) : undefined
}

const tokenHashForRoom = (roomHash: string, token: string) => sha256Hex(`${roomHash}:${token}`)

const setSessionDeviceName = async (
  env: RoomEnv,
  input: { roomHash: string; deviceToken: unknown; name: unknown },
) => {
  const deviceToken = normalizeDeviceToken(input.deviceToken)
  if (!deviceToken) {
    throw new Error('Device token is invalid')
  }
  const tokenHash = await tokenHashForRoom(input.roomHash, deviceToken)
  const room = await loadRoom(env, input.roomHash)
  const name = normalizeUserName(input.name)
  room.devices[tokenHash] = { ...(name ? { name } : {}), updatedAt: new Date().toISOString() }
  await saveRoom(env, input.roomHash, room)
  return name ?? ''
}

const recordSessionOrder = async (
  env: RoomEnv,
  input: { roomHash: string; deviceToken: unknown; lines: OrderAttributionLine[] },
) => {
  const deviceToken = normalizeDeviceToken(input.deviceToken)
  if (!deviceToken) {
    throw new Error('Device token is invalid')
  }
  const tokenHash = await tokenHashForRoom(input.roomHash, deviceToken)
  const room = await loadRoom(env, input.roomHash)
  room.orders.push({ tokenHash, orderedAt: new Date().toISOString(), lines: input.lines })
  await saveRoom(env, input.roomHash, room)
}

const getSessionOrderAttributions = async (env: RoomEnv, roomHash: string) => {
  const room = await loadRoom(env, roomHash)
  const cutoff = Date.now() - ROOM_TTL_MS
  return room.orders
    .filter((order) => Date.parse(order.orderedAt) > cutoff)
    .sort((left, right) => left.orderedAt.localeCompare(right.orderedAt))
    .map((order) => ({
      ...(room.devices[order.tokenHash]?.name ? { name: room.devices[order.tokenHash]!.name } : {}),
      orderedAt: order.orderedAt,
      lines: order.lines,
    }))
}

/* -------------------------------------------------------------- handlers */

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })

const readJSON = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = (await request.json()) as Record<string, unknown>
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

const roomHashFromSnapshot = (snapshot: OfficialSessionSnapshot | undefined) => {
  const roomHash = normalizeRoomHash(snapshot?.roomHash)
  if (!roomHash) {
    throw new Error('Session room is invalid')
  }
  return roomHash
}

const createCheckoutCode = (state: ClientState, account: { controlNo?: string }) =>
  [
    'SZ',
    state.shopId.toString().padStart(4, '0'),
    state.tableNo.toString().padStart(3, '0'),
    account.controlNo ?? state.sessionId ?? state.nextId,
  ].join('-')

export const handleBetterzeriyaAPI = async (
  request: Request,
  env: RoomEnv,
  path: string,
  baseFetch?: FetchSource,
): Promise<Response | undefined> => {
  const sessionMatch = path.match(/^\/api\/sessions(?:\/([^/]+)(?:\/([^/]+))?)?$/)
  if (!sessionMatch) {
    return undefined
  }
  const id = sessionMatch[1] ? decodeURIComponent(sessionMatch[1]) : undefined
  const action = sessionMatch[2]

  try {
    /* POST /api/sessions — start from a QR URL */
    if (!id && request.method === 'POST') {
      const body = await readJSON(request)
      const qrURLSource = String(body.qrURLSource ?? '').trim()
      if (!URL.canParse(qrURLSource)) {
        return json({ error: 'QR URL is invalid' }, { status: 400 })
      }
      try {
        const sessionId = crypto.randomUUID()
        const roomHash = await hashInitialURL(qrURLSource)
        const jar = createCookieFetch([], baseFetch)
        const client = await createClient({ qrURLSource, fetchSource: jar.fetchSource })
        const officialSession = createSnapshot(
          sessionId,
          client.getState(),
          jar.getCookies(),
          Date.now(),
          roomHash,
        )
        return json({ id: sessionId, state: serializeState(client.getState()), officialSession })
      } catch (error) {
        return json({ error: errorMessage(error, 'Failed to start session') }, { status: 502 })
      }
    }

    if (!id) {
      return json({ error: 'Not found' }, { status: 404 })
    }

    const body = await readJSON(request)
    const snapshot = parseOfficialSessionSnapshot(body.officialSession)

    switch (action) {
      case undefined: {
        /* POST /api/sessions/:id — refresh state */
        try {
          const session = await createClientFromSnapshot(id, snapshot, baseFetch)
          return json({
            state: serializeState(session.client.getState()),
            officialSession: session.getSnapshot(),
          })
        } catch (error) {
          return json({ error: errorMessage(error, 'Session not found') }, { status: 404 })
        }
      }
      case 'people': {
        const peopleCount = Number(body.peopleCount)
        if (!Number.isInteger(peopleCount) || peopleCount < 1 || peopleCount > 99) {
          return json({ error: 'People count must be between 1 and 99' }, { status: 400 })
        }
        try {
          const session = await createClientFromSnapshot(id, snapshot, baseFetch)
          const state = await session.client.setPeopleCount(peopleCount)
          return json({ state: serializeState(state), officialSession: session.getSnapshot() })
        } catch (error) {
          return json({ error: errorMessage(error, 'Failed to set people count') }, { status: 502 })
        }
      }
      case 'name': {
        try {
          const name = await setSessionDeviceName(env, {
            roomHash: roomHashFromSnapshot(snapshot),
            deviceToken: body.deviceToken,
            name: body.name,
          })
          return json({ name })
        } catch (error) {
          return json({ error: errorMessage(error, 'Failed to set device name') }, { status: 400 })
        }
      }
      case 'lookup': {
        const code = String(body.code ?? '').trim()
        if (!/^\d{4}$/.test(code)) {
          return json({ error: 'Item code must be 4 digits' }, { status: 400 })
        }
        try {
          const session = await createClientFromSnapshot(id, snapshot, baseFetch)
          const result = await session.client.lookupItem(code)
          return json({ ...result, officialSession: session.getSnapshot() })
        } catch (error) {
          return json({ error: errorMessage(error, 'Failed to lookup item') }, { status: 502 })
        }
      }
      case 'submit': {
        const cart = Array.isArray(body.cart) ? (body.cart as Record<string, unknown>[]) : []
        if (cart.length === 0) {
          return json({ error: 'Cart is empty' }, { status: 400 })
        }
        const normalizedCart: { id: string; count: number; name?: unknown }[] = []
        for (const item of cart) {
          const itemId = String(item.id ?? '').trim()
          const count = Number(item.count ?? 1)
          if (!/^\d{4}$/.test(itemId)) {
            return json({ error: 'Item code must be 4 digits' }, { status: 400 })
          }
          if (!Number.isInteger(count) || count < 1 || count > 99) {
            return json({ error: 'Count must be between 1 and 99' }, { status: 400 })
          }
          normalizedCart.push({ id: itemId, count, name: item.name })
        }
        try {
          const roomHash = roomHashFromSnapshot(snapshot)
          const session = await createClientFromSnapshot(id, snapshot, baseFetch)
          while (session.client.getState().cart.length > 0) {
            await session.client.removeCartItem(0)
          }
          for (const item of normalizedCart) {
            await session.client.addItem(item.id, { count: item.count })
          }
          const state = await session.client.submitOrder()
          await recordSessionOrder(env, {
            roomHash,
            deviceToken: body.deviceToken,
            lines: normalizedCart.map((item) => ({
              code: item.id,
              count: item.count,
              ...(item.name ? { name: String(item.name).slice(0, 100) } : {}),
            })),
          })
          return json({
            state: serializeState(state),
            officialSession: session.getSnapshot(),
            orderAttributions: await getSessionOrderAttributions(env, roomHash),
          })
        } catch (error) {
          return json({ error: errorMessage(error, 'Failed to submit order') }, { status: 502 })
        }
      }
      case 'account':
      case 'receipt': {
        try {
          const session = await createClientFromSnapshot(id, snapshot, baseFetch)
          const accountResult = await session.client.getAccount()
          if (action === 'account') {
            return json({
              state: serializeState(accountResult.state),
              account: accountResult.account,
              barcodeValue: createCheckoutCode(accountResult.state, accountResult.account),
              receiptShown: false,
              officialSession: session.getSnapshot(),
              orderAttributions: await getSessionOrderAttributions(
                env,
                roomHashFromSnapshot(snapshot),
              ),
            })
          }
          const receiptResult = await session.client.getReceipt()
          return json({
            state: serializeState(receiptResult.state),
            account: accountResult.account,
            barcodeValue:
              receiptResult.receipt.barcodeValue ??
              createCheckoutCode(receiptResult.state, accountResult.account),
            barcodeImageSrc: receiptResult.receipt.barcodeImageSrc,
            receiptShown: true,
            officialSession: session.getSnapshot(),
            orderAttributions: await getSessionOrderAttributions(
              env,
              roomHashFromSnapshot(snapshot),
            ),
          })
        } catch (error) {
          return json({ error: errorMessage(error, 'Failed to load account') }, { status: 502 })
        }
      }
      case 'call': {
        try {
          const session = await createClientFromSnapshot(id, snapshot, baseFetch)
          const result = Boolean(body.after)
            ? await session.client.callDessert()
            : await session.client.callStaff()
          return json({ result, officialSession: session.getSnapshot() })
        } catch (error) {
          return json({ error: errorMessage(error, 'Failed to call staff') }, { status: 502 })
        }
      }
      default:
        return json({ error: 'Not found' }, { status: 404 })
    }
  } catch (error) {
    return json({ error: errorMessage(error, 'Internal error') }, { status: 500 })
  }
}
