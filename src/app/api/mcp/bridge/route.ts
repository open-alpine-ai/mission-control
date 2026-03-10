import { NextRequest, NextResponse } from 'next/server'
import { runOpenClaw } from '@/lib/command'
import { getDatabase, logAuditEvent } from '@/lib/db'

function getConfiguredToken(): string {
  const db = getDatabase()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('gateway.mcp_api_token') as { value?: string } | undefined
  return String(row?.value || process.env.MC_MCP_API_TOKEN || process.env.API_KEY || '').trim()
}

function unauthorized() {
  return NextResponse.json({ error: { code: -32001, message: 'Unauthorized' } }, { status: 401 })
}

export async function POST(request: NextRequest) {
  const token = getConfiguredToken()
  const authHeader = request.headers.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
  if (!token || !bearer || bearer !== token) return unauthorized()

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: { code: -32700, message: 'Invalid JSON' } }, { status: 400 })
  }

  const id = body?.id ?? null
  const rpcMethod = String(body?.method || '')

  if (rpcMethod === 'health.check') {
    return NextResponse.json({ jsonrpc: '2.0', id, result: { ok: true, service: 'mission-control-mcp-bridge' } })
  }

  if (rpcMethod !== 'gateway.call') {
    return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }, { status: 400 })
  }

  const method = String(body?.params?.method || '')
  const params = body?.params?.params || {}

  try {
    if (method === 'sessions_send') {
      await runOpenClaw(['gateway', 'sessions_send', '--session', String(params.session), '--message', String(params.message)], {
        timeoutMs: Number(params.timeoutMs || 10000),
      })
      return NextResponse.json({ jsonrpc: '2.0', id, result: { status: 'sent' } })
    }

    if (method === 'agent') {
      const out = await runOpenClaw(
        ['gateway', 'call', 'agent', '--timeout', String(params.timeout || 10000), '--params', JSON.stringify(params), '--json'],
        { timeoutMs: Number(params.timeout || 10000) + 2000 },
      )
      return NextResponse.json({ jsonrpc: '2.0', id, result: out.stdout ? JSON.parse(out.stdout) : {} })
    }

    if (method === 'agent.wait') {
      const out = await runOpenClaw(
        ['gateway', 'call', 'agent.wait', '--timeout', String(params.timeout || 8000), '--params', JSON.stringify(params), '--json'],
        { timeoutMs: Number(params.timeout || 8000) + 2000 },
      )
      return NextResponse.json({ jsonrpc: '2.0', id, result: out.stdout ? JSON.parse(out.stdout) : {} })
    }

    return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unsupported gateway method: ${method}` } }, { status: 400 })
  } catch (error: any) {
    try {
      logAuditEvent({
        action: 'mcp_action',
        actor: 'system',
        target_type: 'gateway',
        detail: { method, ok: false, error: String(error?.message || error) },
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
        user_agent: request.headers.get('user-agent') || 'unknown',
      })
    } catch {
      // best effort
    }
    return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32000, message: String(error?.message || error) } }, { status: 500 })
  }
}
