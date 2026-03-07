/**
 * Local Agent Sync — Discovers agent definitions from local directories
 * and syncs them bidirectionally with the MC database.
 *
 * Scans:
 *   ~/.agents/         — top-level dirs with agent config files
 *   ~/.codex/agents/   — Codex agent definitions
 *   ~/.claude/agents/  — Claude agent definitions (if present)
 *
 * A directory counts as an agent if it contains one of:
 *   AGENT.md, agent.md, soul.md, identity.md, config.json, agent.json
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getDatabase, logAuditEvent } from './db'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiskAgent {
  name: string
  dir: string
  role: string
  soulContent: string | null
  configContent: string | null
  contentHash: string
}

interface AgentRow {
  id: number
  name: string
  role: string
  soul_content: string | null
  status: string
  source: string | null
  content_hash: string | null
  workspace_path: string | null
  config: string | null
}

// Detection files — order matters: first found wins for role extraction
const IDENTITY_FILES = ['soul.md', 'AGENT.md', 'agent.md', 'identity.md']
const CONFIG_FILES = ['config.json', 'agent.json']
const ALL_MARKERS = [...IDENTITY_FILES, ...CONFIG_FILES]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function extractRole(content: string): string {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  // Look for "role:" or "theme:" in first 10 lines
  for (const line of lines.slice(0, 10)) {
    const match = line.match(/^(?:role|theme)\s*:\s*(.+)$/i)
    if (match?.[1]) return match[1].trim()
  }
  return 'agent'
}

function getLocalAgentRoots(): string[] {
  const home = homedir()
  return [
    join(home, '.agents'),
    join(home, '.codex', 'agents'),
    join(home, '.claude', 'agents'),
  ]
}

// ---------------------------------------------------------------------------
// Disk scanner
// ---------------------------------------------------------------------------

function scanLocalAgents(): DiskAgent[] {
  const agents: DiskAgent[] = []

  for (const root of getLocalAgentRoots()) {
    if (!existsSync(root)) continue
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }

    for (const entry of entries) {
      // Skip 'skills' subdirectory — that's the skill roots
      if (entry === 'skills') continue

      const agentDir = join(root, entry)
      try {
        if (!statSync(agentDir).isDirectory()) continue
      } catch {
        continue
      }

      // Check if any marker file exists
      const hasMarker = ALL_MARKERS.some(f => existsSync(join(agentDir, f)))
      if (!hasMarker) continue

      // Read identity content (soul/agent/identity.md)
      let soulContent: string | null = null
      let role = 'agent'
      for (const f of IDENTITY_FILES) {
        const p = join(agentDir, f)
        if (existsSync(p)) {
          try {
            soulContent = readFileSync(p, 'utf8')
            role = extractRole(soulContent)
            break
          } catch { /* unreadable */ }
        }
      }

      // Read config JSON if present
      let configContent: string | null = null
      for (const f of CONFIG_FILES) {
        const p = join(agentDir, f)
        if (existsSync(p)) {
          try {
            configContent = readFileSync(p, 'utf8')
            break
          } catch { /* unreadable */ }
        }
      }

      // Build content hash from whatever identity files exist
      const hashInput = (soulContent || '') + (configContent || '')
      if (!hashInput) continue

      agents.push({
        name: entry,
        dir: agentDir,
        role,
        soulContent,
        configContent,
        contentHash: sha256(hashInput),
      })
    }
  }

  return agents
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

export async function syncLocalAgents(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const diskAgents = scanLocalAgents()
    const now = Math.floor(Date.now() / 1000)

    const diskMap = new Map<string, DiskAgent>()
    for (const a of diskAgents) {
      diskMap.set(a.name, a)
    }

    // Fetch DB agents with source='local'
    const dbRows = db.prepare(
      `SELECT id, name, role, soul_content, status, source, content_hash, workspace_path, config FROM agents WHERE source = 'local'`
    ).all() as AgentRow[]

    const dbMap = new Map<string, AgentRow>()
    for (const r of dbRows) {
      dbMap.set(r.name, r)
    }

    let created = 0
    let updated = 0
    let removed = 0

    const insertStmt = db.prepare(`
      INSERT INTO agents (name, role, soul_content, status, source, content_hash, workspace_path, config, created_at, updated_at)
      VALUES (?, ?, ?, 'offline', 'local', ?, ?, ?, ?, ?)
    `)
    const updateStmt = db.prepare(`
      UPDATE agents SET role = ?, soul_content = ?, content_hash = ?, workspace_path = ?, config = ?, updated_at = ?
      WHERE id = ?
    `)
    const markRemovedStmt = db.prepare(`
      UPDATE agents SET status = 'offline', updated_at = ? WHERE id = ?
    `)

    db.transaction(() => {
      // Disk → DB: additions and changes
      for (const [name, disk] of diskMap) {
        const existing = dbMap.get(name)
        const configJson = disk.configContent ? disk.configContent : null

        if (!existing) {
          insertStmt.run(name, disk.role, disk.soulContent, disk.contentHash, disk.dir, configJson, now, now)
          created++
        } else if (existing.content_hash !== disk.contentHash) {
          updateStmt.run(disk.role, disk.soulContent, disk.contentHash, disk.dir, configJson, now, existing.id)
          updated++
        }
      }

      // Agents that vanished from disk — mark offline but don't delete
      for (const [name, row] of dbMap) {
        if (!diskMap.has(name) && row.status !== 'offline') {
          markRemovedStmt.run(now, row.id)
          removed++
        }
      }
    })()

    const msg = `Local agent sync: ${created} added, ${updated} updated, ${removed} marked offline (${diskAgents.length} on disk)`
    if (created > 0 || updated > 0 || removed > 0) {
      logger.info(msg)
      logAuditEvent({
        action: 'local_agent_sync',
        actor: 'scheduler',
        detail: { created, updated, removed, total: diskAgents.length },
      })
    }
    return { ok: true, message: msg }
  } catch (err: any) {
    logger.error({ err }, 'Local agent sync failed')
    return { ok: false, message: `Local agent sync failed: ${err.message}` }
  }
}

/**
 * Write agent soul content back to disk (UI → Disk direction).
 * Called when a user edits a local agent's soul in the MC UI.
 */
export function writeLocalAgentSoul(agentDir: string, soulContent: string): void {
  // Prefer soul.md, fall back to AGENT.md
  const soulPath = join(agentDir, 'soul.md')
  const agentMdPath = join(agentDir, 'AGENT.md')
  const targetPath = existsSync(soulPath) ? soulPath : existsSync(agentMdPath) ? agentMdPath : soulPath

  mkdirSync(agentDir, { recursive: true })
  writeFileSync(targetPath, soulContent, 'utf8')

  // Update the DB hash so the next sync doesn't re-overwrite
  try {
    const db = getDatabase()
    const hash = sha256(soulContent)
    db.prepare(`UPDATE agents SET content_hash = ?, updated_at = ? WHERE workspace_path = ? AND source = 'local'`)
      .run(hash, Math.floor(Date.now() / 1000), agentDir)
  } catch { /* best-effort */ }
}
