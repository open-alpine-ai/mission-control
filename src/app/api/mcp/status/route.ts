import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { callMcpGatewayMethod, loadMcpTransportConfig } from '@/lib/mcp-transport'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const cfg = loadMcpTransportConfig()

  if (!cfg.enabled) {
    return NextResponse.json({
      enabled: false,
      connected: false,
      transport: 'mcp',
      reason: 'MCP endpoint URL not configured',
    })
  }

  if (!cfg.apiToken) {
    return NextResponse.json({
      enabled: true,
      connected: false,
      transport: 'mcp',
      reason: 'MCP API token missing',
    })
  }

  const startedAt = Date.now()
  const ping = await callMcpGatewayMethod('health.check', {}, cfg)
  const latencyMs = Date.now() - startedAt

  if (!ping.ok) {
    return NextResponse.json({
      enabled: true,
      connected: false,
      transport: 'mcp',
      reason: ping.error || 'Unknown MCP error',
      attempts: ping.attempts,
      statusCode: ping.statusCode,
      latencyMs,
    })
  }

  return NextResponse.json({
    enabled: true,
    connected: true,
    transport: 'mcp',
    latencyMs,
    attempts: ping.attempts,
  })
}
