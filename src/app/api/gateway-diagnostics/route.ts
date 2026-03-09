import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/lib/db'

type GatewayDiagnosticPayload = {
  event?: string
  timestamp?: number
  details?: Record<string, unknown>
}

function sanitizeDetails(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {}
  const clone: Record<string, unknown> = { ...input }

  const redactKeys = ['token', 'authToken', 'deviceToken', 'authorization', 'cookie']
  for (const key of Object.keys(clone)) {
    if (redactKeys.includes(key)) {
      clone[key] = '[REDACTED]'
      continue
    }

    const value = clone[key]
    if (typeof value === 'string' && value.length > 300) {
      clone[key] = `${value.slice(0, 300)}…`
    }
  }

  return clone
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: GatewayDiagnosticPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const event = String(body?.event || '').trim()
  if (!event) {
    return NextResponse.json({ error: 'event is required' }, { status: 400 })
  }

  const details = sanitizeDetails(body?.details)
  const remoteAddr = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  const userAgent = request.headers.get('user-agent') || 'unknown'

  logger.info(
    {
      event,
      ts: Number(body?.timestamp || Date.now()),
      details,
      remoteAddr,
      userAgent,
      source: 'gateway-diagnostics',
    },
    'Gateway connection diagnostic event',
  )

  // Persist a concise diagnostics trail for in-UI live troubleshooting
  try {
    logAuditEvent({
      action: 'gateway_diagnostic',
      actor: auth.user.username,
      actor_id: auth.user.id,
      target_type: 'gateway',
      detail: {
        event,
        details,
        ts: Number(body?.timestamp || Date.now()),
      },
      ip_address: remoteAddr,
      user_agent: userAgent,
    })
  } catch {
    // best effort
  }

  return NextResponse.json({ ok: true })
}
