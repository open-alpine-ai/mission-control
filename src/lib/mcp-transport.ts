import { getDatabase, logAuditEvent } from '@/lib/db'

export interface McpTransportConfig {
  enabled: boolean
  endpointUrl: string
  apiToken: string
  timeoutMs: number
  retryCount: number
}

export interface McpCallResult<T = any> {
  ok: boolean
  transport: 'mcp' | 'cli'
  data?: T
  error?: string
  attempts: number
  statusCode?: number
}

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function loadMcpTransportConfig(): McpTransportConfig {
  const db = getDatabase()
  const rows = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all('gateway.mcp_%') as Array<{ key: string; value: string }>
  const map = new Map(rows.map((r) => [r.key, r.value]))

  const endpointUrl = (map.get('gateway.mcp_endpoint_url') || process.env.MC_MCP_ENDPOINT_URL || '').trim()
  const apiToken = (map.get('gateway.mcp_api_token') || process.env.MC_MCP_API_TOKEN || '').trim()
  const timeoutMs = parseIntWithDefault(map.get('gateway.mcp_timeout_ms') || process.env.MC_MCP_TIMEOUT_MS, 10000)
  const retryCount = Math.max(0, parseIntWithDefault(map.get('gateway.mcp_retry_count') || process.env.MC_MCP_RETRY_COUNT, 2))

  return {
    enabled: endpointUrl.length > 0,
    endpointUrl,
    apiToken,
    timeoutMs,
    retryCount,
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function callMcpGatewayMethod<T = any>(
  method: string,
  params: Record<string, any>,
  cfg: McpTransportConfig
): Promise<McpCallResult<T>> {
  if (!cfg.enabled) {
    return { ok: false, transport: 'mcp', error: 'MCP transport disabled', attempts: 0 }
  }

  if (!cfg.apiToken) {
    return { ok: false, transport: 'mcp', error: 'MCP API token is required', attempts: 0, statusCode: 401 }
  }

  let lastError = 'MCP request failed'
  let lastStatus: number | undefined

  for (let attempt = 0; attempt <= cfg.retryCount; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs)

    try {
      const res = await fetch(cfg.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `mc-${Date.now()}-${attempt}`,
          method: 'gateway.call',
          params: {
            method,
            params,
          },
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          transport: 'mcp',
          error: 'MCP authentication failed (invalid API token)',
          attempts: attempt + 1,
          statusCode: res.status,
        }
      }

      if (!res.ok) {
        lastStatus = res.status
        const text = await res.text()
        lastError = text || `HTTP ${res.status}`
        if (attempt < cfg.retryCount) {
          await delay(Math.min(1000 * (attempt + 1), 3000))
          continue
        }
        return { ok: false, transport: 'mcp', error: lastError, attempts: attempt + 1, statusCode: res.status }
      }

      const payload = await res.json().catch(() => ({})) as any
      if (payload?.error) {
        const rpcError = payload.error?.message || JSON.stringify(payload.error)
        return {
          ok: false,
          transport: 'mcp',
          error: `MCP RPC error: ${rpcError}`,
          attempts: attempt + 1,
          statusCode: res.status,
        }
      }

      return {
        ok: true,
        transport: 'mcp',
        data: (payload?.result ?? payload) as T,
        attempts: attempt + 1,
        statusCode: res.status,
      }
    } catch (error: any) {
      clearTimeout(timeout)
      if (error?.name === 'AbortError') {
        lastError = `MCP timeout after ${cfg.timeoutMs}ms`
      } else {
        lastError = error?.message || 'MCP endpoint unreachable'
      }

      if (attempt < cfg.retryCount) {
        await delay(Math.min(1000 * (attempt + 1), 3000))
        continue
      }

      return {
        ok: false,
        transport: 'mcp',
        error: lastError,
        attempts: attempt + 1,
        statusCode: lastStatus,
      }
    }
  }

  return { ok: false, transport: 'mcp', error: lastError, attempts: cfg.retryCount + 1, statusCode: lastStatus }
}

export async function runGatewayControl(
  method: 'sessions_send' | 'agent' | 'agent.wait',
  params: Record<string, any>,
  audit?: { actor: string; actor_id?: number; ip_address?: string; user_agent?: string }
): Promise<McpCallResult<any>> {
  const cfg = loadMcpTransportConfig()

  if (!cfg.enabled) {
    const result: McpCallResult = {
      ok: false,
      transport: 'mcp',
      attempts: 0,
      statusCode: 503,
      error: 'MCP endpoint is not configured. Set MCP endpoint URL and API token in Mission Control > Gateway/Connections.',
    }
    try {
      if (audit) {
        logAuditEvent({
          action: 'mcp_action',
          actor: audit.actor,
          actor_id: audit.actor_id,
          target_type: 'gateway',
          detail: {
            method,
            transport: 'mcp',
            ok: result.ok,
            attempts: result.attempts,
            statusCode: result.statusCode,
            error: result.error,
          },
          ip_address: audit.ip_address,
          user_agent: audit.user_agent,
        })
      }
    } catch {
      // best effort
    }
    return result
  }

  const result = await callMcpGatewayMethod(method, params, cfg)
  try {
    if (audit) {
      logAuditEvent({
        action: 'mcp_action',
        actor: audit.actor,
        actor_id: audit.actor_id,
        target_type: 'gateway',
        detail: {
          method,
          transport: 'mcp',
          ok: result.ok,
          attempts: result.attempts,
          statusCode: result.statusCode,
          error: result.error || null,
        },
        ip_address: audit.ip_address,
        user_agent: audit.user_agent,
      })
    }
  } catch {
    // best effort
  }
  return result
}
