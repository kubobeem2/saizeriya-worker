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
  it('serves the Web UI at /ui', async () => {
    const response = await handler(new Request('http://worker.test/ui'), env)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain('saizeriya-cli Web UI')
    expect(html).toContain('/sessions')
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
