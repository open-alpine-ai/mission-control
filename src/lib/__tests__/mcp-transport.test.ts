import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callMcpGatewayMethod, type McpTransportConfig } from '@/lib/mcp-transport'

const cfg: McpTransportConfig = {
  enabled: true,
  endpointUrl: 'https://mcp.example.com/rpc',
  apiToken: 'test-token',
  timeoutMs: 25,
  retryCount: 2,
}

describe('mcp transport', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns success on valid MCP response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { status: 'ok' } }),
    } as any)

    const res = await callMcpGatewayMethod('health.check', {}, cfg)
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ status: 'ok' })
    expect(res.attempts).toBe(1)
  })

  it('fails fast on auth failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as any)

    const res = await callMcpGatewayMethod('health.check', {}, cfg)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('authentication failed')
    expect(res.attempts).toBe(1)
  })

  it('reports timeout/unreachable failure', async () => {
    global.fetch = vi.fn().mockImplementation((_url, init: any) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })

    const res = await callMcpGatewayMethod('health.check', {}, { ...cfg, retryCount: 0, timeoutMs: 5 })
    expect(res.ok).toBe(false)
    expect(String(res.error)).toContain('timeout')
  })

  it('retries and succeeds after transient failure', async () => {
    let call = 0
    global.fetch = vi.fn().mockImplementation(async () => {
      call += 1
      if (call < 3) {
        throw new Error('connection refused')
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { status: 'ok' } }),
      } as any
    })

    const res = await callMcpGatewayMethod('health.check', {}, { ...cfg, retryCount: 3 })
    expect(res.ok).toBe(true)
    expect(res.attempts).toBe(3)
  })
})
