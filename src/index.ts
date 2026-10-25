/**
 * saizeriya CLI -> Cloudflare Worker port.
 *
 * The terminal CLI (packages/client/cli.ts) cannot run on Workers:
 * it keeps sessions in ~/.saizeriya-cli/sessions.json (node:fs) and reads
 * commands from an interactive readline REPL. This Worker keeps the same
 * client core (packages/client/src/client.ts, fetch-only + node-html-parser)
 * and exposes the CLI commands as HTTP endpoints instead:
 *
 *   CLI                                   Worker
 *   -----------------------------------   --------------------------------------
 *   saizeriya start <name> <qrurl>        POST /sessions {name, qrURL, people?}
 *   saizeriya list                        GET  /sessions
 *   saizeriya use <name> / state          GET  /sessions/:name
 *   saizeriya rm <name>                   DELETE /sessions/:name
 *   saizeriya menu [query]                GET  /menu?q=<query>
 *   (any in-session command)              POST /sessions/:name/cmd {command, ...}
 *                                         or the dedicated subroutes below.
 *
 * Sessions are stored in the SESSIONS KV namespace when bound. Without KV,
 * the Worker falls back to a per-isolate in-memory store and returns the
 * full session `snapshot` in every response; clients can pass that snapshot
 * back in the next request body to continue statelessly (the same pattern
 * apps/betterzeriya-server uses).
 *
 * If the API_KEY secret is set, every route except GET / requires the
 * `x-api-key` header (or `Authorization: Bearer <key>`).
 */
import { createClient, type ClientState, type LookupItemResult } from './lib/client/client'
import menuData from './data/menu.json'
import { UI_HTML } from './ui'

/* ------------------------------------------------------------------ types */

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }>
}

export interface Env {
  SESSIONS?: KVNamespaceLike
  API_KEY?: string
}

type CookieEntry = [string, string]
type FetchSource = (request: Request) => Promise<Response> | Response

interface SessionSnapshot {
  name: string
  state: ClientState
  cookies: CookieEntry[]
  createdAt: number
  updatedAt: number
}

interface StaticMenuItem {
  id: string
  name: string
  price: number
  state: number
  mod_id?: string
  mod_name?: string
}

interface StaticMenuEntry {
  result: string
  item_data?: StaticMenuItem
}

/* ------------------------------------------------------- session storage */

interface SessionStore {
  get(name: string): Promise<SessionSnapshot | undefined>
  put(snapshot: SessionSnapshot): Promise<void>
  delete(name: string): Promise<void>
  list(): Promise<string[]>
}

const sessionKey = (name: string) => `session:${name}`

const kvStore = (kv: KVNamespaceLike): SessionStore => ({
  get: async (name) => {
    const raw = await kv.get(sessionKey(name))
    return raw ? (JSON.parse(raw) as SessionSnapshot) : undefined
  },
  put: async (snapshot) => {
    await kv.put(sessionKey(snapshot.name), JSON.stringify(snapshot))
  },
  delete: async (name) => {
    await kv.delete(sessionKey(name))
  },
  list: async () => {
    const result = await kv.list({ prefix: 'session:' })
    return result.keys.map((key) => key.name.replace(/^session:/, ''))
  },
})

const memory = new Map<string, SessionSnapshot>()
const memoryStore: SessionStore = {
  get: async (name) => memory.get(name),
  put: async (snapshot) => {
    memory.set(snapshot.name, snapshot)
  },
  delete: async (name) => {
    memory.delete(name)
  },
  list: async () => [...memory.keys()],
}

const storeFor = (env: Env): SessionStore => (env.SESSIONS ? kvStore(env.SESSIONS) : memoryStore)

/* ------------------------------------------------------------ cookie jar */
/* Same cookie-jar fetch the CLI builds in cli.ts, minus the filesystem. */

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

/* -------------------------------------------------------------- responses */

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init?.headers },
  })

const errorResponse = (error: unknown, status = 400) =>
  json({ error: error instanceof Error ? error.message : String(error) }, { status })

const readJSON = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = (await request.json()) as Record<string, unknown>
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

/* ------------------------------------------------------------ static menu */

const staticMenuItems = (menuData as StaticMenuEntry[])
  .map((entry) => entry.item_data)
  .filter((item): item is StaticMenuItem => Boolean(item))

const normalizeSearchText = (value: string) => value.normalize('NFKC').toLowerCase()

const searchStaticMenu = (query: string): StaticMenuItem[] => {
  const normalizedQuery = normalizeSearchText(query.trim())
  if (!normalizedQuery) {
    return staticMenuItems
  }
  return staticMenuItems.filter((item) => {
    return (
      item.id.includes(query.trim()) ||
      normalizeSearchText(item.name).includes(normalizedQuery) ||
      normalizeSearchText(item.mod_name ?? '').includes(normalizedQuery)
    )
  })
}

const officialGetItemURL = 'https://ioes.saizeriya.co.jp/saizeriya2/src/cmd/get_item.php'

/** Mirrors the CLI's `menu <code> --shop <id> --table <id>` official lookup. */
const lookupOfficialMenuItem = async (
  code: string,
  shopId: string,
  tableNo: string,
  baseFetch?: FetchSource,
) => {
  if (!/^\d{4}$/.test(code)) {
    throw new Error('Official menu lookup requires a 4 digit item code')
  }
  const request = new Request(officialGetItemURL, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      origin: 'https://ioes.saizeriya.co.jp',
      referer: 'https://ioes.saizeriya.co.jp/saizeriya2/',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: new URLSearchParams({
      sid: shopId.replace(/^0+/, ''),
      tno: tableNo,
      lng: '1',
      id: code,
      num: '3',
    }),
  })
  const response = baseFetch ? await baseFetch(request) : await fetch(request)
  if (!response.ok) {
    throw new Error(`Failed to fetch menu item: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as LookupItemResult
}

/* --------------------------------------------------------- session runner */

type Client = Awaited<ReturnType<typeof createClient>>

interface SessionRunResult {
  snapshot: SessionSnapshot
  client: Client
}

/**
 * Load (or restore) a session, run `fn` against a live client, then persist
 * the updated state + cookies. Returns the fresh snapshot either way.
 */
const withSession = async (
  env: Env,
  name: string,
  body: Record<string, unknown>,
  baseFetch: FetchSource | undefined,
  fn: (client: Client) => Promise<unknown>,
): Promise<{ result: unknown; snapshot: SessionSnapshot }> => {
  const store = storeFor(env)
  let snapshot = await store.get(name)
  if (!snapshot && body.snapshot && typeof body.snapshot === 'object') {
    const candidate = body.snapshot as SessionSnapshot
    if (candidate.state) {
      snapshot = { ...candidate, name }
    }
  }
  if (!snapshot) {
    throw new SessionNotFoundError(name)
  }

  const jar = createCookieFetch(snapshot.cookies, baseFetch)
  const client = await createClient({ initialState: snapshot.state, fetchSource: jar.fetchSource })
  const result = await fn(client)

  const updated: SessionSnapshot = {
    ...snapshot,
    state: client.getState(),
    cookies: jar.getCookies(),
    updatedAt: Date.now(),
  }
  await store.put(updated)
  return { result, snapshot: updated }
}

class SessionNotFoundError extends Error {
  constructor(name: string) {
    super(`Session "${name}" was not found`)
    this.name = 'SessionNotFoundError'
  }
}

/* --------------------------------------------------------------- commands */

/** Command dispatch shared by /cmd and the dedicated subroutes. */
const runCommand = async (client: Client, command: string, body: Record<string, unknown>) => {
  switch (command) {
    case 'state':
      return { state: client.getState() }
    case 'people': {
      const state = await client.setPeopleCount(Number(body.count ?? body.peopleCount))
      return { state }
    }
    case 'lookup': {
      const result = await client.lookupItem(String(body.code ?? ''))
      return { result }
    }
    case 'add': {
      const state = await client.addItem(String(body.code ?? ''), {
        count: body.count === undefined ? undefined : Number(body.count),
        modId: body.modId === undefined ? undefined : String(body.modId),
        modCount: body.modCount === undefined ? undefined : Number(body.modCount),
        reorder: body.reorder === undefined ? undefined : Boolean(body.reorder),
      })
      return { state }
    }
    case 'remove': {
      const state = await client.removeCartItem(Number(body.index))
      return { state }
    }
    case 'cart':
    case 'cart-page': {
      const state = command === 'cart' ? client.getState() : await client.goToCart()
      return { state, cart: state.cart }
    }
    case 'submit': {
      const state = await client.submitOrder()
      return { state }
    }
    case 'account': {
      const { state, account } = await client.getAccount()
      return { state, account }
    }
    case 'receipt': {
      const { state, account, receipt } = await client.getReceipt()
      return { state, account, receipt }
    }
    case 'call': {
      const after = Boolean(body.after ?? body.kind === 'dessert')
      const result = await client.call({ after })
      return { result }
    }
    case 'history': {
      const state = await client.goToHistory()
      return { state }
    }
    case 'menu-page': {
      const state = await client.goToMenu()
      return { state }
    }
    case 'reorder': {
      const state = await client.reorder(String(body.code ?? ''))
      return { state }
    }
    case 'alcohol': {
      const result = await client.confirmAlcohol()
      return { result }
    }
    case 'check': {
      const kind = String(body.kind ?? 'order')
      const result =
        kind === 'last'
          ? await client.checkLastOrder()
          : kind === 'midnight'
            ? await client.checkMidnight()
            : await client.checkOrderStarted()
      return { result }
    }
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

const COMMAND_ROUTES: Record<string, string> = {
  people: 'people',
  lookup: 'lookup',
  add: 'add',
  remove: 'remove',
  cart: 'cart',
  'cart-page': 'cart-page',
  submit: 'submit',
  account: 'account',
  receipt: 'receipt',
  call: 'call',
  history: 'history',
  'menu-page': 'menu-page',
  reorder: 'reorder',
  alcohol: 'alcohol',
  check: 'check',
  state: 'state',
}

/* ---------------------------------------------------------------- handler */

const HELP = {
  name: 'saizeriya-cli (Worker port)',
  usage: [
    'POST /sessions {name?, qrURL, people?}        start a session (CLI: start)',
    'GET /sessions                                 list sessions (CLI: list)',
    'GET /sessions/:name                           session state (CLI: state)',
    'DELETE /sessions/:name                        delete a session (CLI: rm)',
    'POST /sessions/:name/cmd {command, ...}       run a CLI command',
    'POST /sessions/:name/<command>                dedicated subroutes: people, lookup, add, remove, cart, cart-page, submit, account, receipt, call, history, menu-page, reorder, alcohol, check',
    'GET /menu?q=<query>                           static menu search (CLI: menu)',
    'GET /menu/:code?shop=<id>&table=<id>          official item lookup',
  ],
  commands: Object.keys(COMMAND_ROUTES),
}

export const createHandler = (baseFetch?: FetchSource) => {
  return async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const method = request.method.toUpperCase()

    try {
      if (
        method === 'GET' &&
        (path === '/ui' || (path === '/' && request.headers.get('accept')?.includes('text/html')))
      ) {
        return new Response(UI_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }

      if (path === '/' && method === 'GET') {
        return json(HELP)
      }

      if (env.API_KEY) {
        const provided =
          request.headers.get('x-api-key') ??
          request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
        if (provided !== env.API_KEY) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
      }

      /* ---- static / official menu (CLI: menu) ---- */
      if (path === '/menu' && method === 'GET') {
        const shop = url.searchParams.get('shop')
        const table = url.searchParams.get('table')
        const code = (url.searchParams.get('code') ?? '').trim()
        if (shop || table) {
          if (!shop || !table) {
            throw new Error('shop and table are both required for an official lookup')
          }
          const result = await lookupOfficialMenuItem(code, shop, table, baseFetch)
          return json({ result })
        }
        const items = searchStaticMenu(url.searchParams.get('q') ?? code)
        return json({ items })
      }
      const menuCodeMatch = path.match(/^\/menu\/(\d{4})$/)
      if (menuCodeMatch && method === 'GET') {
        const code = menuCodeMatch[1]!
        const shop = url.searchParams.get('shop')
        const table = url.searchParams.get('table')
        if (shop || table) {
          if (!shop || !table) {
            throw new Error('shop and table are both required for an official lookup')
          }
          const result = await lookupOfficialMenuItem(code, shop, table, baseFetch)
          return json({ result })
        }
        return json({ items: searchStaticMenu(code) })
      }

      /* ---- sessions ---- */
      if (path === '/sessions' && method === 'GET') {
        const store = storeFor(env)
        return json({ sessions: await store.list() })
      }

      if (path === '/sessions' && method === 'POST') {
        const body = await readJSON(request)
        const qrURL = String(body.qrURL ?? body.qrUrl ?? body.qrurl ?? '')
        if (!qrURL) {
          throw new Error('qrURL is required')
        }
        const name =
          typeof body.name === 'string' && body.name.trim()
            ? body.name.trim()
            : `s-${crypto.randomUUID().slice(0, 8)}`
        const jar = createCookieFetch([], baseFetch)
        const client = await createClient({
          qrURLSource: qrURL,
          fetchSource: jar.fetchSource,
          peopleCount: body.people === undefined ? undefined : Number(body.people),
        })
        const snapshot: SessionSnapshot = {
          name,
          state: client.getState(),
          cookies: jar.getCookies(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        await storeFor(env).put(snapshot)
        return json({ name, state: snapshot.state, snapshot }, { status: 201 })
      }

      const sessionMatch = path.match(/^\/sessions\/([^/]+)(?:\/([^/]+))?$/)
      if (sessionMatch) {
        const name = decodeURIComponent(sessionMatch[1]!)
        const sub = sessionMatch[2]

        if (method === 'GET' && !sub) {
          const store = storeFor(env)
          const snapshot = await store.get(name)
          if (!snapshot) {
            throw new SessionNotFoundError(name)
          }
          return json({ name, state: snapshot.state, snapshot })
        }

        if (method === 'DELETE' && !sub) {
          await storeFor(env).delete(name)
          return json({ deleted: name })
        }

        if (method === 'POST' && sub) {
          const body = await readJSON(request)
          const command = sub === 'cmd' ? String(body.command ?? '') : COMMAND_ROUTES[sub]
          if (!command) {
            return json({ error: `Unknown command route: ${sub}` }, { status: 404 })
          }
          const { result, snapshot } = await withSession(env, name, body, baseFetch, (client) =>
            runCommand(client, command, body),
          )
          return json({ ...(result as Record<string, unknown>), snapshot })
        }
      }

      return json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        return errorResponse(error, 404)
      }
      return errorResponse(error)
    }
  }
}

export default {
  fetch: createHandler(),
}
