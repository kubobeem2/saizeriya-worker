/**
 * MCP (Model Context Protocol) server over streamable HTTP at /mcp.
 *
 * Exposes the Saizeriya ordering flow as tools for MCP clients. Session
 * tools are thin wrappers over the Betterzeriya /api handlers: the
 * official-session snapshot is carried by the caller between calls,
 * exactly like the Web UI does. `create_session` requires an explicit
 * `mode` — "real" talks to the official system and can place real
 * orders, "dry" runs against the bundled mock server. The mode is baked
 * into the returned session id (`dry-<uuid>` / `real-<uuid>`) so later
 * calls cannot accidentally switch upstream.
 */
import menuData from './data/menu.json'
import { handleBetterzeriyaAPI } from './betterzeriya'
import { captureDryIntoPayload, dryFetch, restoreDryTable } from './dry'
import type { RoomEnv } from './betterzeriya'

type FetchSource = (request: Request) => Promise<Response> | Response
type Env = RoomEnv & { API_KEY?: string }

interface MenuItem {
  id: string
  name: string
  price: number
}

// The bundled menu.json stores lookup-result objects; the item itself
// lives at entry.item_data (same extraction as the /menu endpoints).
interface RawMenuEntry {
  item_data?: MenuItem
}

const MENU: MenuItem[] = (menuData as RawMenuEntry[])
  .map((entry) => entry.item_data)
  .filter((item): item is MenuItem => Boolean(item))

// Menu names are stored half-width; normalize like the /menu search does.
const normalizeSearchText = (value: string) => value.normalize('NFKC').toLowerCase()

const json = (value: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })

const rpcError = (id: unknown, code: number, message: string) =>
  json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

const toolResult = (payload: unknown, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  ...(isError ? {} : { structuredContent: payload as Record<string, unknown> }),
  isError,
})

const sessionProps = {
  session_id: {
    type: 'string',
    description: 'Session id returned by create_session (includes the mode prefix).',
  },
  official_session: {
    type: 'object',
    description:
      'The officialSession object from the previous tool result. Pass it back unchanged.',
  },
} as const

export const MCP_TOOLS = [
  {
    name: 'menu_search',
    description:
      'Search the Saizeriya menu by name keyword. Returns matching items with code and price.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Keyword, e.g. ティラミス' } },
      required: ['query'],
    },
  },
  {
    name: 'menu_item',
    description: 'Look up one menu item by its 4-digit code in the static menu data.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: '4-digit item code, e.g. 3201' } },
      required: ['code'],
    },
  },
  {
    name: 'create_session',
    description:
      'Start an ordering session from a table QR URL. mode is required: "real" connects to the official system (orders are real), "dry" uses the built-in mock server (nothing is actually ordered). Returns session_id and official_session — pass both to every later session tool.',
    inputSchema: {
      type: 'object',
      properties: {
        qr_url: { type: 'string', description: 'The table QR URL (must contain "saizeriya").' },
        mode: {
          type: 'string',
          enum: ['real', 'dry'],
          description: 'real = actual ordering, dry = mock practice run.',
        },
      },
      required: ['qr_url', 'mode'],
    },
  },
  {
    name: 'get_session_state',
    description: 'Refresh and return the current session state (cart, page, people count).',
    inputSchema: {
      type: 'object',
      properties: { ...sessionProps },
      required: ['session_id', 'official_session'],
    },
  },
  {
    name: 'set_people_count',
    description: 'Set how many people are at the table.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sessionProps,
        people_count: { type: 'number', description: 'Number of people (1-99).' },
      },
      required: ['session_id', 'official_session', 'people_count'],
    },
  },
  {
    name: 'set_device_name',
    description: 'Set the display name for this device so the order list shows who ordered what.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sessionProps,
        name: { type: 'string', description: 'Display name, e.g. たなか' },
        device_token: {
          type: 'string',
          description:
            'Optional. Reuse the same token for submit_order to attribute the order to this name.',
        },
      },
      required: ['session_id', 'official_session', 'name'],
    },
  },
  {
    name: 'lookup_item',
    description:
      'Look up an item on the official menu for this session (checks availability/options).',
    inputSchema: {
      type: 'object',
      properties: { ...sessionProps, code: { type: 'string', description: '4-digit item code.' } },
      required: ['session_id', 'official_session', 'code'],
    },
  },
  {
    name: 'submit_order',
    description:
      'Submit an order for the given cart. In real mode this actually orders food — make sure the cart is what the user wants. Returns the new state and order attributions.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sessionProps,
        cart: {
          type: 'array',
          description: 'Items to order.',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', description: '4-digit item code.' },
              count: { type: 'number', description: 'Quantity (1-99).' },
              name: { type: 'string', description: 'Optional item name for display.' },
            },
            required: ['code', 'count'],
          },
        },
        device_token: {
          type: 'string',
          description: 'Optional token from set_device_name for order attribution.',
        },
      },
      required: ['session_id', 'official_session', 'cart'],
    },
  },
  {
    name: 'get_account',
    description:
      'Get the bill for this session (ordered items, total) plus a checkout barcode value.',
    inputSchema: {
      type: 'object',
      properties: { ...sessionProps },
      required: ['session_id', 'official_session'],
    },
  },
  {
    name: 'get_receipt',
    description: 'Get the receipt view for this session.',
    inputSchema: {
      type: 'object',
      properties: { ...sessionProps },
      required: ['session_id', 'official_session'],
    },
  },
  {
    name: 'call_staff',
    description: 'Call a staff member to the table.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sessionProps,
        after_dessert: { type: 'boolean', description: 'True for the after-dessert call variant.' },
      },
      required: ['session_id', 'official_session'],
    },
  },
] as const

const parseCompoundId = (compound: unknown): { mode: 'real' | 'dry'; id: string } | undefined => {
  if (typeof compound !== 'string') return undefined
  if (compound.startsWith('dry-')) return { mode: 'dry', id: compound.slice(4) }
  if (compound.startsWith('real-')) return { mode: 'real', id: compound.slice(5) }
  return undefined
}

export const handleMCP = async (
  request: Request,
  env: Env,
  baseFetch?: FetchSource,
): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed. POST JSON-RPC messages to /mcp.' }, { status: 405 })
  }
  if (env.API_KEY) {
    const provided =
      request.headers.get('x-api-key') ??
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (provided !== env.API_KEY) {
      return json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let message: { id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    message = (await request.json()) as typeof message
  } catch {
    return rpcError(null, -32700, 'Parse error')
  }
  const id = message.id ?? null
  const method = message.method ?? ''

  // Notifications have no id and need no response body.
  if (id === null || (typeof method === 'string' && method.startsWith('notifications/'))) {
    return new Response(null, { status: 202 })
  }

  switch (method) {
    case 'initialize': {
      const requested = (message.params?.protocolVersion as string) ?? '2025-03-26'
      return json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: requested,
          capabilities: { tools: {} },
          serverInfo: { name: 'saizeriya-mcp', version: '0.1.0' },
        },
      })
    }
    case 'ping':
      return json({ jsonrpc: '2.0', id, result: {} })
    case 'tools/list':
      return json({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } })
    case 'tools/call': {
      const name = String(message.params?.name ?? '')
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>
      const result = await callTool(name, args, env, baseFetch)
      return json({ jsonrpc: '2.0', id, result })
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

const callTool = async (
  name: string,
  args: Record<string, unknown>,
  env: Env,
  baseFetch?: FetchSource,
) => {
  try {
    switch (name) {
      case 'menu_search': {
        const query = String(args.query ?? '').trim()
        const normalized = normalizeSearchText(query)
        const items = MENU.filter(
          (item) => item.id.includes(query) || normalizeSearchText(item.name).includes(normalized),
        ).slice(0, 50)
        return toolResult({ query, count: items.length, items })
      }
      case 'menu_item': {
        const code = String(args.code ?? '').trim()
        const item = MENU.find((entry) => entry.id === code)
        return item ? toolResult(item) : toolResult({ error: `Menu item not found: ${code}` }, true)
      }
      case 'create_session': {
        const mode = args.mode
        if (mode !== 'real' && mode !== 'dry') {
          return toolResult({ error: 'mode is required: "real" or "dry"' }, true)
        }
        const upstream = mode === 'dry' ? dryFetch : baseFetch
        const response = await dispatch(upstream, env, '/api/sessions', {
          qrURLSource: String(args.qr_url ?? ''),
        })
        const payload = await readPayload(response)
        if (!response.ok) return toolResult(payload, true)
        if (mode === 'dry') captureDryIntoPayload(payload)
        const created = payload as { id: string; officialSession: unknown; state: unknown }
        return toolResult({
          session_id: `${mode}-${created.id}`,
          mode,
          state: created.state,
          official_session: created.officialSession,
        })
      }
      default:
        break
    }

    // Session tools share the compound-id + snapshot plumbing.
    const parsed = parseCompoundId(args.session_id)
    if (!parsed) {
      return toolResult(
        { error: 'session_id must come from create_session (dry-… / real-…)' },
        true,
      )
    }
    const upstream = parsed.mode === 'dry' ? dryFetch : baseFetch
    const officialSession = args.official_session
    if (parsed.mode === 'dry') restoreDryTable(officialSession)
    const base = `/api/sessions/${parsed.id}`

    switch (name) {
      case 'get_session_state': {
        const response = await dispatch(upstream, env, base, { officialSession })
        return wrapSessionResponse(response, parsed.mode)
      }
      case 'set_people_count': {
        const response = await dispatch(upstream, env, `${base}/people`, {
          officialSession,
          peopleCount: Number(args.people_count),
        })
        return wrapSessionResponse(response, parsed.mode)
      }
      case 'set_device_name': {
        const deviceToken =
          typeof args.device_token === 'string' && args.device_token
            ? args.device_token
            : crypto.randomUUID()
        const response = await dispatch(upstream, env, `${base}/name`, {
          officialSession,
          deviceToken,
          name: String(args.name ?? ''),
        })
        const payload = await readPayload(response)
        if (!response.ok) return toolResult(payload, true)
        return toolResult({ ...(payload as object), device_token: deviceToken })
      }
      case 'lookup_item': {
        const response = await dispatch(upstream, env, `${base}/lookup`, {
          officialSession,
          code: String(args.code ?? ''),
        })
        return wrapSessionResponse(response, parsed.mode)
      }
      case 'submit_order': {
        const cart = Array.isArray(args.cart) ? args.cart : []
        const response = await dispatch(upstream, env, `${base}/submit`, {
          officialSession,
          deviceToken:
            typeof args.device_token === 'string' && args.device_token
              ? args.device_token
              : crypto.randomUUID(),
          cart: cart.map((item) => {
            const entry = item as Record<string, unknown>
            return {
              id: String(entry.code ?? ''),
              count: Number(entry.count ?? 1),
              ...(entry.name ? { name: String(entry.name) } : {}),
            }
          }),
        })
        return wrapSessionResponse(response, parsed.mode)
      }
      case 'get_account': {
        const response = await dispatch(upstream, env, `${base}/account`, { officialSession })
        return wrapSessionResponse(response, parsed.mode)
      }
      case 'get_receipt': {
        const response = await dispatch(upstream, env, `${base}/receipt`, { officialSession })
        return wrapSessionResponse(response, parsed.mode)
      }
      case 'call_staff': {
        const response = await dispatch(upstream, env, `${base}/call`, {
          officialSession,
          after: Boolean(args.after_dessert),
        })
        return wrapSessionResponse(response, parsed.mode)
      }
      default:
        return toolResult({ error: `Unknown tool: ${name}` }, true)
    }
  } catch (error) {
    return toolResult({ error: error instanceof Error ? error.message : 'Tool call failed' }, true)
  }
}

const dispatch = (
  upstream: FetchSource | undefined,
  env: Env,
  path: string,
  body: unknown,
): Promise<Response> =>
  handleBetterzeriyaAPI(
    new Request(`http://mcp.internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
    path,
    upstream,
  ).then(
    (response) => response ?? new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
  )

const readPayload = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { error: text || `HTTP ${response.status}` }
  }
}

const wrapSessionResponse = async (response: Response, mode?: string) => {
  const payload = (await readPayload(response)) as Record<string, unknown>
  if (!response.ok) return toolResult(payload, true)
  if (mode === 'dry') captureDryIntoPayload(payload)
  const { officialSession, ...rest } = payload
  return toolResult({ ...rest, official_session: officialSession })
}
