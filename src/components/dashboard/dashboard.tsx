'use client'

import { useState, useCallback } from 'react'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { Button } from '@/components/ui/button'

interface DbStats {
  tasks: { total: number; byStatus: Record<string, number> }
  agents: { total: number; byStatus: Record<string, number> }
  audit: { day: number; week: number; loginFailures: number }
  activities: { day: number }
  notifications: { unread: number }
  pipelines: { active: number; recentDay: number }
  backup: { name: string; size: number; age_hours: number } | null
  dbSizeBytes: number
  webhookCount: number
}

interface ClaudeStats {
  total_sessions: number
  active_sessions: number
  total_input_tokens: number
  total_output_tokens: number
  total_estimated_cost: number
  unique_projects: number
}

type LogLike = {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  message: string
}


export function Dashboard() {
  const {
    sessions,
    setSessions,
    connection,
    dashboardMode,
    subscription,
    logs,
    agents,
    tasks,
    setActiveConversation,
  } = useMissionControl()

  const navigateToPanel = useNavigateToPanel()
  const isLocal = dashboardMode === 'local'

  const subscriptionLabel = subscription?.type
    ? subscription.type.charAt(0).toUpperCase() + subscription.type.slice(1)
    : null

  const SUBSCRIPTION_PRICES: Record<string, Record<string, number>> = {
    anthropic: { pro: 20, max: 100, max_5x: 200, team: 30, enterprise: 30 },
    openai: { plus: 20, chatgpt: 20, pro: 200, team: 30, enterprise: 0 },
  }

  const subscriptionPrice = subscription?.provider && subscription?.type
    ? SUBSCRIPTION_PRICES[subscription.provider]?.[subscription.type] ?? null
    : null

  const [systemStats, setSystemStats] = useState<any>(null)
  const [dbStats, setDbStats] = useState<DbStats | null>(null)
  const [claudeStats, setClaudeStats] = useState<ClaudeStats | null>(null)
  const [githubStats, setGithubStats] = useState<any>(null)
  const [loading, setLoading] = useState({
    system: true,
    sessions: true,
    claude: true,
    github: true,
  })

  const loadDashboard = useCallback(async () => {
    const requests: Promise<void>[] = []

    requests.push(
      fetch('/api/status?action=dashboard')
        .then(async (res) => {
          if (!res.ok) return
          const data = await res.json()
          if (data && !data.error) {
            setSystemStats(data)
            if (data.db) setDbStats(data.db)
          }
        })
        .catch(() => {
          // silent
        })
        .finally(() => setLoading(prev => ({ ...prev, system: false })))
    )

    requests.push(
      fetch('/api/sessions')
        .then(async (res) => {
          if (!res.ok) return
          const data = await res.json()
          if (data && !data.error) setSessions(data.sessions || data)
        })
        .catch(() => {
          // silent
        })
        .finally(() => setLoading(prev => ({ ...prev, sessions: false })))
    )

    if (isLocal) {
      requests.push(
        fetch('/api/claude/sessions')
          .then(async (res) => {
            if (!res.ok) return
            const data = await res.json()
            if (data?.stats) setClaudeStats(data.stats)
          })
          .catch(() => {
            // silent
          })
          .finally(() => setLoading(prev => ({ ...prev, claude: false })))
      )

      requests.push(
        fetch('/api/github?action=stats')
          .then(async (res) => {
            if (!res.ok) return
            const data = await res.json()
            if (data && !data.error) setGithubStats(data)
          })
          .catch(() => {
            // silent
          })
          .finally(() => setLoading(prev => ({ ...prev, github: false })))
      )
    } else {
      setLoading(prev => ({ ...prev, claude: false, github: false }))
    }

    await Promise.allSettled(requests)
  }, [isLocal, setSessions])

  useSmartPoll(loadDashboard, isLocal ? 15000 : 60000, { pauseWhenConnected: true })

  const isSystemLoading = loading.system && !systemStats
  const isSessionsLoading = loading.sessions && sessions.length === 0
  const isClaudeLoading = isLocal && loading.claude && !claudeStats
  const isGithubLoading = isLocal && loading.github && !githubStats

  const memPct = systemStats?.memory?.total
    ? Math.round((systemStats.memory.used / systemStats.memory.total) * 100)
    : null

  const diskPct = parseInt(systemStats?.disk?.usage || '', 10)
  const systemLoad = Math.max(memPct ?? 0, Number.isFinite(diskPct) ? diskPct : 0)

  const activeSessions = sessions.filter((s) => s.active).length
  const errorCount = logs.filter((l) => l.level === 'error').length
  const onlineAgents = dbStats
    ? dbStats.agents.total - (dbStats.agents.byStatus?.offline ?? 0)
    : agents.filter((a) => a.status !== 'offline').length

  const claudeLocalSessions = sessions.filter((s) => s.kind === 'claude-code')
  const codexLocalSessions = sessions.filter((s) => s.kind === 'codex-cli')
  const claudeActive = claudeLocalSessions.filter((s) => s.active).length
  const codexActive = codexLocalSessions.filter((s) => s.active).length

  const runningTasks = dbStats?.tasks.byStatus?.in_progress ?? tasks.filter((t) => t.status === 'in_progress').length
  const inboxCount = dbStats?.tasks.byStatus?.inbox ?? 0
  const assignedCount = dbStats?.tasks.byStatus?.assigned ?? 0
  const reviewCount = (dbStats?.tasks.byStatus?.review ?? 0) + (dbStats?.tasks.byStatus?.quality_review ?? 0)
  const doneCount = dbStats?.tasks.byStatus?.done ?? 0
  const backlogCount = inboxCount + assignedCount + reviewCount

  const localOsStatus = isSystemLoading
    ? { value: 'Loading...', status: 'warn' as const }
    : getLocalOsStatus(memPct, Number.isFinite(diskPct) ? diskPct : null)

  const claudeHealth = isClaudeLoading
    ? { value: 'Loading...', status: 'warn' as const }
    : getProviderHealth(claudeStats?.active_sessions ?? claudeActive, claudeStats?.total_sessions ?? claudeLocalSessions.length)

  const codexHealth = isSessionsLoading
    ? { value: 'Loading...', status: 'warn' as const }
    : getProviderHealth(codexActive, codexLocalSessions.length)

  const mcHealth = isSystemLoading
    ? { value: 'Loading...', status: 'warn' as const }
    : getMcHealth(systemStats, dbStats, errorCount)

  const localSessionLogs: LogLike[] = isLocal
    ? sessions.reduce<LogLike[]>((acc, session) => {
        const ts = session.lastActivity || session.startTime || 0
        if (!ts) return acc

        const lastPrompt = typeof (session as any).lastUserPrompt === 'string'
          ? (session as any).lastUserPrompt.trim()
          : ''

        acc.push({
          id: `local-session-${session.id}-${ts}`,
          timestamp: ts,
          level: 'info',
          source: session.kind === 'codex-cli' ? 'codex-local' : 'claude-local',
          message: lastPrompt
            ? `Prompt: ${lastPrompt}`
            : `${session.active ? 'Active' : 'Idle'} session: ${session.key || session.id}`,
        })
        return acc
      }, [])
    : []

  const mergedRecentLogs: LogLike[] = (isLocal ? [...logs, ...localSessionLogs] : logs)
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((entry, index, arr) => arr.findIndex((x) => x.id === entry.id) === index)
    .slice(0, 10)

  const recentErrorLogs = mergedRecentLogs.filter((log) => log.level === 'error').length
  const gatewayHealthStatus = connection.isConnected ? 'good' : 'bad'

  const openSession = useCallback((session: any) => {
    const kind = String(session?.kind || '')
    const sid = String(session?.id || '')
    if (!sid) return
    setActiveConversation(`session:${kind}:${sid}`)
    navigateToPanel('chat')
  }, [setActiveConversation, navigateToPanel])

  return (
    <div className="p-5 space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">Overview</div>
            <h2 className="text-lg font-semibold text-foreground">
              {isLocal ? 'Local Agent Runtime' : 'Gateway Control Plane'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isLocal
                ? 'Unified visibility for Claude + Codex local sessions, host pressure, and operator continuity.'
                : 'Gateway-first health, session routing, queue pressure, and incident response signals.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 min-w-[280px]">
            <SignalPill label="Mode" value={isLocal ? 'Local' : 'Gateway'} tone="info" />
            <SignalPill label="Events" value={`${mergedRecentLogs.length} stream`} tone={recentErrorLogs > 0 ? 'warning' : 'success'} />
            <SignalPill label="Queue" value={String(backlogCount)} tone={backlogCount > 10 ? 'warning' : 'info'} />
            <SignalPill label="Errors" value={String(errorCount)} tone={errorCount > 0 ? 'warning' : 'success'} />
          </div>
        </div>
      </section>

      {isLocal ? (
        <>
          <section className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <MetricCard label="Claude" value={isClaudeLoading ? '...' : claudeActive} total={isClaudeLoading ? undefined : (claudeStats?.total_sessions ?? claudeLocalSessions.length)} subtitle="active sessions" icon={<SessionIcon />} color="blue" />
            <MetricCard label="Codex" value={isSessionsLoading ? '...' : codexActive} total={isSessionsLoading ? undefined : codexLocalSessions.length} subtitle="active sessions" icon={<SessionIcon />} color="green" />
            <MetricCard label="System Load" value={isSystemLoading ? '...' : `${systemLoad}%`} subtitle={`mem ${memPct ?? '-'} · disk ${Number.isFinite(diskPct) ? `${diskPct}%` : '-'}`} icon={<ActivityIconMini />} color={systemLoad > 85 ? 'red' : 'purple'} />
            <MetricCard label="Tokens" value={isClaudeLoading ? '...' : formatTokensShort((claudeStats?.total_input_tokens ?? 0) + (claudeStats?.total_output_tokens ?? 0))} subtitle={isClaudeLoading ? undefined : `${formatTokensShort(claudeStats?.total_input_tokens ?? 0)} in · ${formatTokensShort(claudeStats?.total_output_tokens ?? 0)} out`} icon={<TokenIcon />} color="purple" />
            <MetricCard label="Cost" value={isClaudeLoading ? '...' : (subscriptionLabel ? (subscriptionPrice ? `$${subscriptionPrice}/mo` : 'Included') : `$${(claudeStats?.total_estimated_cost ?? 0).toFixed(2)}`)} subtitle={subscriptionLabel ? `${subscriptionLabel} plan` : 'estimated'} icon={<CostIcon />} color={errorCount > 0 ? 'red' : 'green'} />
          </section>

          <section className="grid xl:grid-cols-12 gap-4">
            <div className="xl:col-span-4 panel">
              <div className="panel-header"><h3 className="text-sm font-semibold">Local Runtime Health</h3></div>
              <div className="panel-body space-y-3">
                <HealthRow label="Local OS" value={localOsStatus.value} status={localOsStatus.status} />
                <HealthRow label="Claude Runtime" value={claudeHealth.value} status={claudeHealth.status} />
                <HealthRow label="Codex Runtime" value={codexHealth.value} status={codexHealth.status} />
                <HealthRow label="MC Core" value={mcHealth.value} status={mcHealth.status} />
                {memPct != null && <HealthRow label="Memory" value={`${memPct}%`} status={memPct > 90 ? 'bad' : memPct > 70 ? 'warn' : 'good'} bar={memPct} />}
                {systemStats?.disk && <HealthRow label="Disk" value={systemStats.disk.usage || 'N/A'} status={parseInt(systemStats.disk.usage) > 90 ? 'bad' : 'good'} />}
                {systemStats?.uptime != null && <HealthRow label="Uptime" value={formatUptime(systemStats.uptime)} status="good" />}
              </div>
            </div>

            <div className="xl:col-span-4 panel">
              <div className="panel-header">
                <h3 className="text-sm font-semibold">Session Workbench</h3>
                <span className="text-2xs text-muted-foreground font-mono-tight">{sessions.length}</span>
              </div>
              <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
                {sessions.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-xs text-muted-foreground">{isSessionsLoading ? 'Loading sessions...' : 'No sessions found'}</p>
                    <p className="text-2xs text-muted-foreground/60 mt-1">Sessions appear when Claude/Codex are active locally.</p>
                  </div>
                ) : (
                  sessions.slice(0, 10).map((session) => (
                    <div key={session.id} className="px-4 py-2.5 hover:bg-secondary/20 transition-smooth">
                      <button
                        type="button"
                        onClick={() => openSession(session)}
                        className="w-full text-left flex items-center gap-3"
                      >
                        <div className={`w-2 h-2 rounded-full shrink-0 ${session.active ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate font-mono-tight">{session.key || session.id}</div>
                          <div className="text-2xs text-muted-foreground">{session.kind === 'codex-cli' ? 'Codex' : session.kind === 'claude-code' ? 'Claude' : session.kind} · {session.model?.split('/').pop() || 'unknown'}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-2xs font-mono-tight text-muted-foreground">{session.tokens}</div>
                          <div className="text-2xs text-muted-foreground">{session.age}</div>
                        </div>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="xl:col-span-4 panel">
              <div className="panel-header">
                <h3 className="text-sm font-semibold">Local Event Stream</h3>
                <span className="text-2xs text-muted-foreground font-mono-tight">{mergedRecentLogs.length}</span>
              </div>
              <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
                {mergedRecentLogs.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-xs text-muted-foreground">{isSessionsLoading ? 'Loading logs...' : 'No logs yet'}</p>
                    <p className="text-2xs text-muted-foreground/60 mt-1">Local Claude/Codex events stream here.</p>
                  </div>
                ) : (
                  mergedRecentLogs.map((log) => (
                    <LogRow key={log.id} log={log} />
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="grid xl:grid-cols-12 gap-4">
            <div className="xl:col-span-6 panel">
              <div className="panel-header"><h3 className="text-sm font-semibold">Task Flow</h3></div>
              <div className="panel-body grid grid-cols-2 gap-3">
                <StatRow label="Inbox" value={inboxCount} />
                <StatRow label="Assigned" value={assignedCount} />
                <StatRow label="In Progress" value={runningTasks} />
                <StatRow label="Review" value={reviewCount} />
                <StatRow label="Done" value={doneCount} />
                <StatRow label="Backlog" value={backlogCount} alert={backlogCount > 12} />
              </div>
            </div>

            <div className="xl:col-span-6 panel">
              <div className="panel-header">
                <h3 className="text-sm font-semibold">GitHub Signal</h3>
                {isLocal && githubStats?.user && <span className="text-2xs text-muted-foreground font-mono-tight">@{githubStats.user.login}</span>}
              </div>
              <div className="panel-body space-y-3">
                {githubStats ? (
                  <>
                    <StatRow label="Active repos" value={githubStats.repos.total} />
                    <StatRow label="Public / Private" value={`${githubStats.repos.public} / ${githubStats.repos.private}`} />
                    <StatRow label="Open issues" value={githubStats.repos.total_open_issues} />
                    <StatRow label="Stars" value={githubStats.repos.total_stars} />
                  </>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-xs text-muted-foreground">{isGithubLoading ? 'Loading GitHub stats...' : 'No GitHub token configured'}</p>
                    {!isGithubLoading && <p className="text-2xs text-muted-foreground/60 mt-1">Set GITHUB_TOKEN in .env.local</p>}
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="grid grid-cols-2 xl:grid-cols-5 gap-3">
            <MetricCard label="Gateway" value={connection.isConnected ? 'Online' : 'Offline'} subtitle="transport status" icon={<GatewayIcon />} color={connection.isConnected ? 'green' : 'red'} />
            <MetricCard label="Sessions" value={activeSessions} total={sessions.length} subtitle="active / total" icon={<SessionIcon />} color="blue" />
            <MetricCard label="Agent Capacity" value={onlineAgents} subtitle={`${dbStats?.agents.total ?? agents.length} total`} icon={<AgentIcon />} color="green" />
            <MetricCard label="Queue" value={backlogCount} subtitle={`${runningTasks} running`} icon={<TaskIcon />} color={backlogCount > 12 ? 'red' : 'purple'} />
            <MetricCard label="System Load" value={isSystemLoading ? '...' : `${systemLoad}%`} subtitle={`errors ${errorCount}`} icon={<ActivityIconMini />} color={systemLoad > 85 || errorCount > 0 ? 'red' : 'blue'} />
          </section>

          <section className="grid xl:grid-cols-12 gap-4">
            <div className="xl:col-span-4 panel">
              <div className="panel-header"><h3 className="text-sm font-semibold">Gateway Health + Golden Signals</h3></div>
              <div className="panel-body space-y-3">
                <HealthRow label="Gateway" value={connection.isConnected ? 'Connected' : 'Disconnected'} status={gatewayHealthStatus} />
                <HealthRow label="Traffic (sessions)" value={`${sessions.length}`} status={sessions.length > 0 ? 'good' : 'warn'} />
                <HealthRow label="Errors (24h)" value={`${errorCount}`} status={errorCount > 0 ? 'warn' : 'good'} />
                <HealthRow label="Saturation (queue)" value={`${backlogCount}`} status={backlogCount > 16 ? 'bad' : backlogCount > 8 ? 'warn' : 'good'} />
                {memPct != null && <HealthRow label="Memory" value={`${memPct}%`} status={memPct > 90 ? 'bad' : memPct > 70 ? 'warn' : 'good'} bar={memPct} />}
                {systemStats?.disk && <HealthRow label="Disk" value={systemStats.disk.usage || 'N/A'} status={parseInt(systemStats.disk.usage) > 90 ? 'bad' : 'good'} />}
              </div>
            </div>

            <div className="xl:col-span-4 panel">
              <div className="panel-header">
                <h3 className="text-sm font-semibold">Session Router</h3>
                <span className="text-2xs text-muted-foreground font-mono-tight">{sessions.length}</span>
              </div>
              <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
                {sessions.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-xs text-muted-foreground">{isSessionsLoading ? 'Loading sessions...' : 'No gateway sessions'}</p>
                    <p className="text-2xs text-muted-foreground/60 mt-1">Sessions appear when gateway agents connect.</p>
                  </div>
                ) : (
                  sessions.slice(0, 10).map((session) => (
                    <div key={session.id} className="px-4 py-2.5 hover:bg-secondary/20 transition-smooth">
                      <button
                        type="button"
                        onClick={() => openSession(session)}
                        className="w-full text-left flex items-center gap-3"
                      >
                        <div className={`w-2 h-2 rounded-full shrink-0 ${session.active ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate font-mono-tight">{session.key || session.id}</div>
                          <div className="text-2xs text-muted-foreground">{session.kind} · {session.model?.split('/').pop() || 'unknown'}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-2xs font-mono-tight text-muted-foreground">{session.tokens}</div>
                          <div className="text-2xs text-muted-foreground">{session.age}</div>
                        </div>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="xl:col-span-4 panel">
              <div className="panel-header">
                <h3 className="text-sm font-semibold">Incident Stream</h3>
                <span className="text-2xs text-muted-foreground font-mono-tight">{recentErrorLogs} errors</span>
              </div>
              <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
                {mergedRecentLogs.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-xs text-muted-foreground">No logs yet</p>
                    <p className="text-2xs text-muted-foreground/60 mt-1">Gateway incidents and warnings stream here.</p>
                  </div>
                ) : (
                  mergedRecentLogs.map((log) => <LogRow key={log.id} log={log} />)
                )}
              </div>
            </div>
          </section>

          <section className="grid xl:grid-cols-12 gap-4">
            <div className="xl:col-span-6 panel">
              <div className="panel-header"><h3 className="text-sm font-semibold">Maintenance + Backup</h3></div>
              <div className="panel-body space-y-3">
                {dbStats?.backup ? (
                  <>
                    <StatRow label="Latest backup" value={dbStats.backup.age_hours < 1 ? '<1h ago' : `${dbStats.backup.age_hours}h ago`} alert={dbStats.backup.age_hours > 24} />
                    <StatRow label="Backup size" value={formatBytes(dbStats.backup.size)} />
                  </>
                ) : (
                  <StatRow label="Latest backup" value="None" alert />
                )}
                <StatRow label="Active pipelines" value={dbStats?.pipelines.active ?? 0} />
                <StatRow label="Pipeline runs (24h)" value={dbStats?.pipelines.recentDay ?? 0} />
              </div>
            </div>

            <div className="xl:col-span-6 panel">
              <div className="panel-header"><h3 className="text-sm font-semibold">Security + Audit</h3></div>
              <div className="panel-body space-y-3">
                <StatRow label="Audit events (24h)" value={dbStats?.audit.day ?? 0} />
                <StatRow label="Audit events (7d)" value={dbStats?.audit.week ?? 0} />
                <StatRow label="Login failures (24h)" value={dbStats?.audit.loginFailures ?? 0} alert={dbStats ? dbStats.audit.loginFailures > 0 : false} />
                <StatRow label="Unread notifications" value={dbStats?.notifications.unread ?? 0} alert={(dbStats?.notifications.unread ?? 0) > 0} />
              </div>
            </div>
          </section>
        </>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {!isLocal && <QuickAction label="Spawn Agent" desc="Launch sub-agent" tab="spawn" icon={<SpawnActionIcon />} onNavigate={navigateToPanel} />}
        <QuickAction label="View Logs" desc="Realtime viewer" tab="logs" icon={<LogActionIcon />} onNavigate={navigateToPanel} />
        <QuickAction label="Task Board" desc="Flow + queue control" tab="tasks" icon={<TaskActionIcon />} onNavigate={navigateToPanel} />
        <QuickAction label="Memory" desc="Knowledge + recall" tab="memory" icon={<MemoryActionIcon />} onNavigate={navigateToPanel} />
        {isLocal
          ? <QuickAction label="Sessions" desc="Claude + Codex" tab="sessions" icon={<SessionIcon />} onNavigate={navigateToPanel} />
          : <QuickAction label="Orchestration" desc="Workflows + pipelines" tab="agents" icon={<PipelineActionIcon />} onNavigate={navigateToPanel} />}
      </section>
    </div>
  )
}

function MetricCard({ label, value, total, subtitle, icon, color }: {
  label: string
  value: number | string
  total?: number
  subtitle?: string
  icon: React.ReactNode
  color: 'blue' | 'green' | 'purple' | 'red'
}) {
  const colorMap = {
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
  }

  return (
    <div className={`rounded-lg border p-3.5 ${colorMap[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium opacity-80">{label}</span>
        <div className="w-5 h-5 opacity-60">{icon}</div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold font-mono-tight">{value}</span>
        {total != null && <span className="text-xs opacity-50 font-mono-tight">/ {total}</span>}
      </div>
      {subtitle && <div className="text-2xs opacity-50 font-mono-tight mt-0.5">{subtitle}</div>}
    </div>
  )
}

function SignalPill({ label, value, tone }: {
  label: string
  value: string
  tone: 'success' | 'warning' | 'info'
}) {
  const toneClass = tone === 'success'
    ? 'bg-green-500/15 border-green-500/30 text-green-300'
    : tone === 'warning'
      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
      : 'bg-blue-500/15 border-blue-500/30 text-blue-300'

  return (
    <div className={`rounded-lg border px-2.5 py-2 ${toneClass}`}>
      <div className="text-2xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-xs font-semibold font-mono-tight truncate">{value}</div>
    </div>
  )
}

function HealthRow({ label, value, status, bar }: {
  label: string
  value: string
  status: 'good' | 'warn' | 'bad'
  bar?: number
}) {
  const statusColor = status === 'good' ? 'text-green-400' : status === 'warn' ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-xs font-medium font-mono-tight ${statusColor}`}>{value}</span>
      </div>
      {bar != null && (
        <div className="h-1 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${bar > 90 ? 'bg-red-500' : bar > 70 ? 'bg-amber-500' : 'bg-green-500'}`}
            style={{ width: `${Math.min(bar, 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}

function StatRow({ label, value, alert }: { label: string; value: number | string; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium font-mono-tight ${alert ? 'text-red-400' : 'text-muted-foreground'}`}>
        {value}
      </span>
    </div>
  )
}

function LogRow({ log }: { log: LogLike }) {
  return (
    <div className="px-4 py-2 hover:bg-secondary/30 transition-smooth">
      <div className="flex items-start gap-2">
        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
          log.level === 'error' ? 'bg-red-500' :
          log.level === 'warn' ? 'bg-amber-500' :
          log.level === 'debug' ? 'bg-gray-500' :
          'bg-blue-500/50'
        }`} />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground/80 break-words">{log.message.length > 100 ? log.message.slice(0, 100) + '...' : log.message}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-2xs text-muted-foreground font-mono-tight">{log.source}</span>
            <span className="text-2xs text-muted-foreground/40">·</span>
            <span className="text-2xs text-muted-foreground">{new Date(log.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}


function QuickAction({ label, desc, tab, icon, onNavigate }: {
  label: string
  desc: string
  tab: string
  icon: React.ReactNode
  onNavigate: (tab: string) => void
}) {
  return (
    <Button
      variant="outline"
      onClick={() => onNavigate(tab)}
      className="flex items-center gap-3 p-3 h-auto rounded-lg hover:border-primary/30 hover:bg-primary/5 text-left group justify-start"
    >
      <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-smooth">
        <div className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-smooth">{icon}</div>
      </div>
      <div>
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="text-2xs text-muted-foreground">{desc}</div>
      </div>
    </Button>
  )
}

function formatUptime(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  return `${hours}h`
}

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getProviderHealth(active: number, total: number): { value: string; status: 'good' | 'warn' | 'bad' } {
  if (total === 0) return { value: 'No sessions', status: 'warn' }
  if (active > 0) return { value: `${active} active`, status: 'good' }
  return { value: `Idle (${total})`, status: 'warn' }
}

function getLocalOsStatus(memPct: number | null, diskPct: number | null): { value: string; status: 'good' | 'warn' | 'bad' } {
  if (memPct == null && diskPct == null) return { value: 'Unknown', status: 'bad' }
  const maxPct = Math.max(memPct ?? 0, diskPct ?? 0)
  if (maxPct >= 95) return { value: 'Critical', status: 'bad' }
  if (maxPct >= 80) return { value: 'Degraded', status: 'warn' }
  return { value: 'Healthy', status: 'good' }
}

function getMcHealth(systemStats: any, dbStats: DbStats | null, errorCount: number): { value: string; status: 'good' | 'warn' | 'bad' } {
  if (!systemStats || !dbStats) return { value: 'Unavailable', status: 'bad' }
  if (errorCount > 0) return { value: `${errorCount} errors`, status: 'warn' }
  return { value: 'Healthy', status: 'good' }
}

function SessionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 3h12v9H2zM5 12v2M11 12v2M4 14h8" />
    </svg>
  )
}

function AgentIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  )
}

function GatewayIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 8h3M11 8h3M5 5l3-3 3 3M5 11l3 3 3-3" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}

function ActivityIconMini() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 9h2l1.4-3.5L8.2 12l2-5H14" />
    </svg>
  )
}

function TaskIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="1" width="12" height="14" rx="1.5" />
      <path d="M5 5h6M5 8h6M5 11h3" />
    </svg>
  )
}

function SpawnActionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M8 2v12M8 2l-3 3M8 2l3 3" />
    </svg>
  )
}

function LogActionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M5 5h6M5 8h6M5 11h3" />
    </svg>
  )
}

function TaskActionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="1" width="12" height="14" rx="1.5" />
      <path d="M5 5l2 2 3-3" />
      <path d="M5 10h6" />
    </svg>
  )
}

function MemoryActionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <ellipse cx="8" cy="8" rx="6" ry="3" />
      <path d="M2 8v3c0 1.7 2.7 3 6 3s6-1.3 6-3V8" />
    </svg>
  )
}

function PipelineActionIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="3" cy="8" r="2" />
      <circle cx="13" cy="4" r="2" />
      <circle cx="13" cy="12" r="2" />
      <path d="M5 7l6-2M5 9l6 2" />
    </svg>
  )
}

function TokenIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v8M5 6h6M5 10h6" />
    </svg>
  )
}

function CostIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 3.5V5M8 11v1.5M10.5 6.5C10.5 5.4 9.4 4.5 8 4.5S5.5 5.4 5.5 6.5c0 1.1 1.1 2 2.5 2s2.5.9 2.5 2c0 1.1-1.1 2-2.5 2s-2.5-.9-2.5-2" />
    </svg>
  )
}
