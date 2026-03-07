import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: string }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

type TranscriptMessage = {
  role: 'user' | 'assistant' | 'system'
  parts: MessageContentPart[]
  timestamp?: string
}

function messageTimestampMs(message: TranscriptMessage): number {
  if (!message.timestamp) return 0
  const ts = new Date(message.timestamp).getTime()
  return Number.isFinite(ts) ? ts : 0
}

function listRecentFiles(root: string, ext: string, limit: number): string[] {
  if (!root || !fs.existsSync(root)) return []

  const files: Array<{ path: string; mtimeMs: number }> = []
  const stack = [root]

  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue

    let entries: string[] = []
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }

    for (const entry of entries) {
      const full = path.join(dir, entry)
      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        stack.push(full)
        continue
      }

      if (!stat.isFile() || !full.endsWith(ext)) continue
      files.push({ path: full, mtimeMs: stat.mtimeMs })
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return files.slice(0, Math.max(1, limit)).map((f) => f.path)
}

function pushMessage(
  list: TranscriptMessage[],
  role: TranscriptMessage['role'],
  parts: MessageContentPart[],
  timestamp?: string,
) {
  if (parts.length === 0) return
  list.push({ role, parts, timestamp })
}

function textPart(content: string | null, limit = 8000): MessageContentPart | null {
  const text = String(content || '').trim()
  if (!text) return null
  return { type: 'text', text: text.slice(0, limit) }
}

function readClaudeTranscript(sessionId: string, limit: number): TranscriptMessage[] {
  const root = path.join(config.claudeHome, 'projects')
  const files = listRecentFiles(root, '.jsonl', 300)
  const out: TranscriptMessage[] = []

  for (const file of files) {
    let raw = ''
    try {
      raw = fs.readFileSync(file, 'utf-8')
    } catch {
      continue
    }

    const lines = raw.split('\n').filter(Boolean)
    for (const line of lines) {
      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      if (parsed?.sessionId !== sessionId || parsed?.isSidechain) continue

      const ts = typeof parsed?.timestamp === 'string' ? parsed.timestamp : undefined
      if (parsed?.type === 'user') {
        const content = typeof parsed?.message?.content === 'string'
          ? parsed.message.content
          : Array.isArray(parsed?.message?.content)
            ? parsed.message.content.map((b: any) => b?.text || '').join('\n').trim()
            : ''
        pushMessage(out, 'user', content, ts)
      } else if (parsed?.type === 'assistant') {
        const content = Array.isArray(parsed?.message?.content)
          ? parsed.message.content
              .filter((b: any) => b?.type === 'text' && typeof b?.text === 'string')
              .map((b: any) => b.text)
              .join('\n')
              .trim()
          : ''
        pushMessage(out, 'assistant', content, ts)
      }
    }
  }

  const sorted = out
    .slice()
    .sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b))
  return sorted.slice(-limit)
}

function readCodexTranscript(sessionId: string, limit: number): TranscriptMessage[] {
  const root = path.join(config.homeDir, '.codex', 'sessions')
  const files = listRecentFiles(root, '.jsonl', 300)
  const out: TranscriptMessage[] = []

  for (const file of files) {
    let raw = ''
    try {
      raw = fs.readFileSync(file, 'utf-8')
    } catch {
      continue
    }

    let matchedSession = file.includes(sessionId)
    const lines = raw.split('\n').filter(Boolean)
    for (const line of lines) {
      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      if (!matchedSession && parsed?.type === 'session_meta' && parsed?.payload?.id === sessionId) {
        matchedSession = true
      }
      if (!matchedSession) continue

      const ts = typeof parsed?.timestamp === 'string' ? parsed.timestamp : undefined
      if (parsed?.type === 'response_item' && parsed?.payload?.type === 'message') {
        const role = parsed?.payload?.role === 'assistant' ? 'assistant' : 'user'
        const content = typeof parsed?.payload?.content === 'string'
          ? parsed.payload.content
          : Array.isArray(parsed?.payload?.content)
            ? parsed.payload.content.map((b: any) => b?.text || '').join('\n').trim()
            : ''
        pushMessage(out, role, content, ts)
      }
    }
  }

  const sorted = out
    .slice()
    .sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b))
  return sorted.slice(-limit)
}

/**
 * GET /api/sessions/transcript
 * Query params:
 *   kind=claude-code|codex-cli
 *   id=<session-id>
 *   limit=40
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const kind = searchParams.get('kind') || ''
    const sessionId = searchParams.get('id') || ''
    const limit = Math.min(parseInt(searchParams.get('limit') || '40', 10), 200)

    if (!sessionId || (kind !== 'claude-code' && kind !== 'codex-cli')) {
      return NextResponse.json({ error: 'kind and id are required' }, { status: 400 })
    }

    const messages = kind === 'claude-code'
      ? readClaudeTranscript(sessionId, limit)
      : readCodexTranscript(sessionId, limit)

    return NextResponse.json({ messages })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/sessions/transcript error')
    return NextResponse.json({ error: 'Failed to fetch transcript' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
