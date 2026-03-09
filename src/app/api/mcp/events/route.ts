import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 200)

  const db = getDatabase()
  const rows = db.prepare(`
    SELECT id, action, actor, detail, created_at
    FROM audit_log
    WHERE action IN ('mcp_action', 'gateway_diagnostic')
    ORDER BY id DESC
    LIMIT ?
  `).all(limit) as Array<{ id: number; action: string; actor: string; detail: string | null; created_at: number }>

  const events = rows.map((r) => {
    let detail: any = null
    try { detail = r.detail ? JSON.parse(r.detail) : null } catch { detail = r.detail }
    return {
      id: r.id,
      action: r.action,
      actor: r.actor,
      detail,
      created_at: r.created_at,
    }
  })

  return NextResponse.json({ events })
}
