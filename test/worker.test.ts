import { describe, expect, it } from 'vite-plus/test'
import mockServer from './mock-server/main'
import { createHandler } from '../src/index'

const handler = createHandler(mockServer.fetch as never)
const env = {}

const call = async (path: string, init?: RequestInit) => {
  const response = await handler(new Request(`http://worker.test${path}`, init), env)
  const body = (await response.json()) as Record<string, unknown>
  return { response, body }
}

const post = (path: string, data: unknown) =>
  call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  })

describe('saizeriya worker (CLI port)', () => {
  it('serves the Betterzeriya SPA through the assets binding', async () => {
    const assets = async (request: Request) => {
      const pathname = new URL(request.url).pathname
      if (pathname === '/index.html' || pathname === '/') {
        return new Response('<html><body>betterzeriya</body></html>', {
          headers: { 'content-type': 'text/html' },
        })
      }
      return new Response('not found', { status: 404 })
    }
    const spaHandler = createHandler(mockServer.fetch as never, assets)

    const root = await spaHandler(
      new Request('http://worker.test/', { headers: { accept: 'text/html' } }),
      env,
    )
    expect(root.status).toBe(200)
    expect(await root.text()).toContain('betterzeriya')

    const clientRoute = await spaHandler(
      new Request('http://worker.test/sessions/some-id', { headers: { accept: 'text/html' } }),
      env,
    )
    expect(clientRoute.status).toBe(200)
    expect(await clientRoute.text()).toContain('betterzeriya')

    const legacy = await spaHandler(new Request('http://worker.test/ui'), env)
    expect(legacy.status).toBe(302)
    expect(legacy.headers.get('location')).toBe('/')
  })

  it('runs the Betterzeriya /api flow against the mock server', async () => {
    const created = await post('/api/sessions', { qrURLSource: 'http://example.com/saizeriya3/qr' })
    expect(created.response.status).toBe(200)
    const id = created.body.id as string
    const officialSession = created.body.officialSession as Record<string, unknown>
    expect(id).toBeTruthy()
    expect(officialSession.roomHash).toMatch(/^[a-f0-9]{64}$/)
    expect((created.body.state as Record<string, unknown>).baseURL).toBeUndefined()

    const deviceToken = 'device-token-0123456789-abcdefghij'
    const named = await post(`/api/sessions/${id}/name`, {
      officialSession,
      deviceToken,
      name: 'テスト端末',
    })
    expect(named.body).toEqual({ name: 'テスト端末' })

    const people = await post(`/api/sessions/${id}/people`, {
      officialSession: named.body.officialSession ?? officialSession,
      peopleCount: 2,
    })
    expect(people.response.status).toBe(200)
    const session2 = people.body.officialSession as Record<string, unknown>
    expect((people.body.state as Record<string, unknown>).peopleCount).toBe(2)

    const lookup = await post(`/api/sessions/${id}/lookup`, {
      officialSession: session2,
      code: '1202',
    })
    expect(lookup.response.status).toBe(200)
    expect(lookup.body.result).toBe('OK')
    const session3 = lookup.body.officialSession as Record<string, unknown>

    const submitted = await post(`/api/sessions/${id}/submit`, {
      officialSession: session3,
      deviceToken,
      cart: [{ id: '1202', count: 2, name: '小ｴﾋﾞのｻﾗﾀﾞ' }],
    })
    expect(submitted.response.status).toBe(200)
    const attributions = submitted.body.orderAttributions as { name?: string; lines: unknown[] }[]
    expect(attributions).toHaveLength(1)
    expect(attributions[0]?.name).toBe('テスト端末')
    expect(attributions[0]?.lines).toHaveLength(1)
    const session4 = submitted.body.officialSession as Record<string, unknown>

    const account = await post(`/api/sessions/${id}/account`, { officialSession: session4 })
    expect(account.response.status).toBe(200)
    expect(account.body.account).toMatchObject({ count: 2, total: 700 })
    expect(account.body.barcodeValue).toMatch(/^SZ-/)
    expect(account.body.receiptShown).toBe(false)

    const receipt = await post(`/api/sessions/${id}/receipt`, {
      officialSession: account.body.officialSession,
    })
    expect(receipt.response.status).toBe(200)
    expect(receipt.body.receiptShown).toBe(true)

    const called = await post(`/api/sessions/${id}/call`, {
      officialSession: receipt.body.officialSession,
      after: false,
    })
    expect(called.response.status).toBe(200)
    expect(called.body.result).toEqual({ result: 'OK' })
  })

  it('serves help and the static menu (CLI: menu)', async () => {
    const help = await call('/')
    expect(help.response.status).toBe(200)
    expect(help.body.usage).toBeDefined()

    const menu = await call('/menu?q=ティラミス')
    expect(menu.response.status).toBe(200)
    const items = menu.body.items as { id: string; name: string }[]
    expect(items.length).toBeGreaterThan(0)
    expect(items.some((item) => item.id === '3201')).toBe(true)

    const byCode = await call('/menu/3201')
    expect((byCode.body.items as { id: string }[])[0]?.id).toBe('3201')
  })

  it('runs a full order flow against the mock server', async () => {
    const created = await post('/sessions', {
      name: 'worker-test',
      qrURL: 'http://example.com/saizeriya3/qr',
      people: 2,
    })
    expect(created.response.status).toBe(201)
    expect(created.body.state).toMatchObject({ peopleCount: 2, pageKind: 'menu' })

    const lookup = await post('/sessions/worker-test/cmd', { command: 'lookup', code: '1202' })
    expect(lookup.response.status).toBe(200)
    expect(lookup.body.result).toMatchObject({ result: 'OK', item_data: { id: '1202' } })

    const added = await post('/sessions/worker-test/add', { code: '1202', count: 2 })
    expect(added.response.status).toBe(200)
    expect((added.body.state as { cart: unknown[] }).cart).toHaveLength(1)

    const submitted = await post('/sessions/worker-test/submit', {})
    expect(submitted.response.status).toBe(200)
    expect((submitted.body.state as { cart: unknown[] }).cart).toHaveLength(0)

    const account = await post('/sessions/worker-test/account', {})
    expect(account.response.status).toBe(200)
    expect(account.body.account).toMatchObject({ count: 2, total: 700 })

    const listed = await call('/sessions')
    expect(listed.body.sessions).toContain('worker-test')

    const removed = await call('/sessions/worker-test', { method: 'DELETE' })
    expect(removed.response.status).toBe(200)
    const missing = await call('/sessions/worker-test')
    expect(missing.response.status).toBe(404)
  })

  it('rejects unknown sessions and commands', async () => {
    const missing = await post('/sessions/nope/cmd', { command: 'state' })
    expect(missing.response.status).toBe(404)

    await post('/sessions', { name: 'worker-test-2', qrURL: 'http://example.com/saizeriya3/qr' })
    const unknown = await post('/sessions/worker-test-2/cmd', { command: 'bogus' })
    expect(unknown.response.status).toBe(400)
  })
})
