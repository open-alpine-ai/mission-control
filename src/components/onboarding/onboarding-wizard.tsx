'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { SecurityScanCard } from './security-scan-card'

interface StepInfo {
  id: string
  title: string
  completed: boolean
}

interface OnboardingState {
  showOnboarding: boolean
  currentStep: number
  steps: StepInfo[]
}

interface DiagSecurityCheck {
  name: string
  pass: boolean
  detail: string
}

interface SystemCapabilities {
  claudeSessions: number
  agentCount: number
  gatewayConnected: boolean
  hasSkills: boolean
}

const STEPS = [
  { id: 'welcome', title: 'Welcome' },
  { id: 'credentials', title: 'Credentials' },
  { id: 'gateway', title: 'Agent Setup' },
  { id: 'security', title: 'Security Scan' },
  { id: 'next-steps', title: 'Get Started' },
]

export function OnboardingWizard() {
  const { showOnboarding, setShowOnboarding, dashboardMode, gatewayAvailable } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()
  const [step, setStep] = useState(0)
  const [slideDir, setSlideDir] = useState<'left' | 'right'>('left')
  const [animating, setAnimating] = useState(false)
  const [state, setState] = useState<OnboardingState | null>(null)
  const [credentialStatus, setCredentialStatus] = useState<{ authOk: boolean; apiKeyOk: boolean } | null>(null)
  const [closing, setClosing] = useState(false)
  const [capabilities, setCapabilities] = useState<SystemCapabilities>({
    claudeSessions: 0,
    agentCount: 0,
    gatewayConnected: false,
    hasSkills: false,
  })

  useEffect(() => {
    if (!showOnboarding) return
    fetch('/api/onboarding')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setState(data)
          setStep(data.currentStep)
        }
      })
      .catch(() => {})

    // Fetch system capabilities in parallel
    Promise.allSettled([
      fetch('/api/status?action=capabilities').then(r => r.ok ? r.json() : null),
      fetch('/api/agents?limit=1').then(r => r.ok ? r.json() : null),
    ]).then(([statusResult, agentsResult]) => {
      const statusData = statusResult.status === 'fulfilled' ? statusResult.value : null
      const agentsData = agentsResult.status === 'fulfilled' ? agentsResult.value : null
      setCapabilities({
        claudeSessions: statusData?.claudeSessions ?? 0,
        gatewayConnected: statusData?.gateway ?? false,
        agentCount: agentsData?.total ?? 0,
        hasSkills: false,
      })
    })
  }, [showOnboarding])

  useEffect(() => {
    if (step !== 1 || credentialStatus) return
    fetch('/api/diagnostics')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.security?.checks) {
          const checks = data.security.checks as DiagSecurityCheck[]
          const authOk = checks.find(c => c.name === 'Auth password secure')?.pass ?? false
          const apiKeyOk = checks.find(c => c.name === 'API key configured')?.pass ?? false
          setCredentialStatus({ authOk, apiKeyOk })
        }
      })
      .catch(() => {})
  }, [step, credentialStatus])

  const completeStep = useCallback(async (stepId: string) => {
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete_step', step: stepId }),
    }).catch(() => {})
  }, [])

  const finish = useCallback(async () => {
    setClosing(true)
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete' }),
    }).catch(() => {})
    setTimeout(() => setShowOnboarding(false), 300)
  }, [setShowOnboarding])

  const skip = useCallback(async () => {
    setClosing(true)
    await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'skip' }),
    }).catch(() => {})
    setTimeout(() => setShowOnboarding(false), 300)
  }, [setShowOnboarding])

  const goNext = useCallback(() => {
    const steps = state?.steps || []
    const currentId = steps[step]?.id
    if (currentId) completeStep(currentId)
    setSlideDir('left')
    setAnimating(true)
    setTimeout(() => {
      setStep(s => Math.min(s + 1, 4))
      setAnimating(false)
    }, 150)
  }, [step, state, completeStep])

  const goBack = useCallback(() => {
    setSlideDir('right')
    setAnimating(true)
    setTimeout(() => {
      setStep(s => Math.max(s - 1, 0))
      setAnimating(false)
    }, 150)
  }, [])

  if (!showOnboarding || !state) return null

  const totalSteps = 5
  const isGateway = dashboardMode === 'full' || gatewayAvailable

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${closing ? 'opacity-0' : 'opacity-100'}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={skip} />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-background border border-border/50 rounded-xl shadow-2xl overflow-hidden">
        {/* Progress bar */}
        <div className="h-0.5 bg-surface-2">
          <div
            className="h-full bg-void-cyan transition-all duration-500"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>

        {/* Step indicator */}
        <div className="flex flex-col items-center gap-1 pt-4 pb-2">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === step ? 'bg-void-cyan' : i < step ? 'bg-void-cyan/40' : 'bg-surface-2'
                }`}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{STEPS[step]?.title}</span>
        </div>

        {/* Content */}
        <div className={`px-6 py-4 min-h-[320px] flex flex-col transition-all duration-150 ${
          animating
            ? `opacity-0 ${slideDir === 'left' ? '-translate-x-3' : 'translate-x-3'}`
            : 'opacity-100 translate-x-0'
        }`}>
          {step === 0 && (
            <StepWelcome isGateway={isGateway} capabilities={capabilities} onNext={goNext} onSkip={skip} />
          )}
          {step === 1 && (
            <StepCredentials status={credentialStatus} onNext={goNext} onBack={goBack} navigateToPanel={navigateToPanel} onClose={() => setShowOnboarding(false)} />
          )}
          {step === 2 && (
            <StepGateway isGateway={isGateway} capabilities={capabilities} onNext={goNext} onBack={goBack} navigateToPanel={navigateToPanel} onClose={() => setShowOnboarding(false)} />
          )}
          {step === 3 && (
            <StepSecurity onNext={goNext} onBack={goBack} />
          )}
          {step === 4 && (
            <StepNextSteps isGateway={isGateway} onFinish={finish} onBack={goBack} navigateToPanel={navigateToPanel} onClose={() => setShowOnboarding(false)} />
          )}
        </div>
      </div>
    </div>
  )
}

function StepWelcome({ isGateway, capabilities, onNext, onSkip }: {
  isGateway: boolean
  capabilities: SystemCapabilities
  onNext: () => void
  onSkip: () => void
}) {
  return (
    <>
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-surface-1 border border-border/50 flex items-center justify-center shadow-lg">
          <img src="/brand/mc-logo-128.png" alt="Mission Control" className="w-full h-full object-cover" />
        </div>
        <div>
          <h2 className="text-xl font-semibold mb-2">Welcome to Mission Control</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Your open-source hub for managing AI agents and Claude Code sessions.
            We&apos;ve already scanned your setup — here&apos;s what we found.
          </p>
        </div>

        {/* Live status chips */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <StatusChip
            ok={capabilities.claudeSessions > 0}
            label={capabilities.claudeSessions > 0
              ? `${capabilities.claudeSessions} active session${capabilities.claudeSessions !== 1 ? 's' : ''} detected`
              : 'No active Claude sessions'}
          />
          <StatusChip
            ok={capabilities.gatewayConnected}
            label={capabilities.gatewayConnected ? 'Gateway connected' : 'Local mode — no gateway'}
          />
          <StatusChip
            ok={capabilities.agentCount > 0}
            label={capabilities.agentCount > 0
              ? `${capabilities.agentCount} agent${capabilities.agentCount !== 1 ? 's' : ''} registered`
              : 'No agents yet'}
          />
        </div>

        {/* What you can do — mode-adaptive */}
        <div className="w-full max-w-sm">
          <p className="text-xs text-muted-foreground text-center mb-2">What you can do right now</p>
          <div className="grid grid-cols-3 gap-2">
            {isGateway ? (
              <>
                <CapabilityCard title="Orchestrate" desc="Coordinate multiple AI agents working together" />
                <CapabilityCard title="Communicate" desc="Inter-agent messaging and wake/delegate commands" />
                <CapabilityCard title="Extend" desc="Install skills from the marketplace to add capabilities" />
              </>
            ) : (
              <>
                <CapabilityCard title="Monitor" desc="Watch Claude Code sessions in real-time" />
                <CapabilityCard title="Track" desc="Token usage, costs, and performance metrics" />
                <CapabilityCard title="Manage" desc="Kanban task board for organizing agent work" />
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <Button variant="ghost" size="sm" onClick={onSkip} className="text-xs text-muted-foreground">
          Skip setup
        </Button>
        <Button onClick={onNext} size="sm" className="bg-void-cyan/20 text-void-cyan border border-void-cyan/30 hover:bg-void-cyan/30">
          Get started
        </Button>
      </div>
    </>
  )
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-1 border border-border/30">
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-green-400' : 'bg-surface-2'}`} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function CapabilityCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-surface-1/50 border border-border/30 text-center">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="text-2xs text-muted-foreground mt-0.5">{desc}</p>
    </div>
  )
}

function StepCredentials({
  status,
  onNext,
  onBack,
  navigateToPanel,
  onClose,
}: {
  status: { authOk: boolean; apiKeyOk: boolean } | null
  onNext: () => void
  onBack: () => void
  navigateToPanel: (panel: string) => void
  onClose: () => void
}) {
  const allGood = status?.authOk && status?.apiKeyOk

  return (
    <>
      <div className="flex-1">
        <h2 className="text-lg font-semibold mb-1">Credentials Check</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Both you and your agents need secure credentials. The admin password protects the dashboard,
          while the API key (X-Api-Key header) lets agents self-register and communicate with Mission Control.
        </p>

        {!status ? (
          <div className="py-4">
            <Loader variant="inline" label="Checking credentials..." />
          </div>
        ) : (
          <div className="space-y-3">
            <div className={`flex items-start gap-3 p-3 rounded-lg border ${status.authOk ? 'border-green-400/20 bg-green-400/5' : 'border-red-400/20 bg-red-400/5'}`}>
              <span className={`font-mono text-sm mt-0.5 ${status.authOk ? 'text-green-400' : 'text-red-400'}`}>
                [{status.authOk ? '+' : 'x'}]
              </span>
              <div>
                <p className="text-sm font-medium">Admin Password</p>
                <p className="text-xs text-muted-foreground">
                  {status.authOk ? 'Password is strong and non-default' : 'Using a default or weak password — change AUTH_PASS in .env'}
                </p>
              </div>
            </div>

            <div className={`flex items-start gap-3 p-3 rounded-lg border ${status.apiKeyOk ? 'border-green-400/20 bg-green-400/5' : 'border-red-400/20 bg-red-400/5'}`}>
              <span className={`font-mono text-sm mt-0.5 ${status.apiKeyOk ? 'text-green-400' : 'text-red-400'}`}>
                [{status.apiKeyOk ? '+' : 'x'}]
              </span>
              <div>
                <p className="text-sm font-medium">API Key</p>
                <p className="text-xs text-muted-foreground">
                  {status.apiKeyOk
                    ? 'API key is configured — agents can self-register via X-Api-Key header'
                    : 'API key is not set. Agents won\'t be able to self-register without a configured API key. Run: bash scripts/generate-env.sh --force'}
                </p>
              </div>
            </div>

            {!allGood && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => { onClose(); navigateToPanel('settings') }}
              >
                Open Settings
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs text-muted-foreground">Back</Button>
        <Button onClick={onNext} size="sm" className="bg-void-cyan/20 text-void-cyan border border-void-cyan/30 hover:bg-void-cyan/30">
          {allGood ? 'Continue' : 'Continue anyway'}
        </Button>
      </div>
    </>
  )
}

function StepGateway({
  isGateway,
  capabilities,
  onNext,
  onBack,
  navigateToPanel,
  onClose,
}: {
  isGateway: boolean
  capabilities: SystemCapabilities
  onNext: () => void
  onBack: () => void
  navigateToPanel: (panel: string) => void
  onClose: () => void
}) {
  return (
    <>
      <div className="flex-1">
        <h2 className="text-lg font-semibold mb-1">Your Platform Features</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {isGateway
            ? 'Gateway connected — you have access to the full feature set. Here\'s everything available to you and your agents.'
            : 'You\'re in local mode, which is great for monitoring Claude Code. Here\'s what\'s available now and what you\'d unlock with a gateway.'}
        </p>

        {isGateway ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg border border-green-400/20 bg-green-400/5">
              <span className="font-mono text-sm mt-0.5 text-green-400">[+]</span>
              <div>
                <p className="text-sm font-medium">Full Platform Unlocked</p>
                <p className="text-xs text-muted-foreground">
                  Gateway enables agent orchestration, inter-agent communication, and the complete skills ecosystem.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <FeatureItem label="Agent orchestration" desc="Register, wake, and delegate across agents" />
              <FeatureItem label="Soul & personality" desc="Configure agent identity via SOUL files" />
              <FeatureItem label="Working memory" desc="Per-agent scratchpad for context persistence" />
              <FeatureItem label="Skills marketplace" desc="Install and manage agent capabilities" />
              <FeatureItem label="Wake/delegate" desc="Trigger agents and hand off tasks" />
              <FeatureItem label="Inter-agent comms" desc="Agents communicate and coordinate" />
            </div>

            {capabilities.agentCount === 0 && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs border-void-cyan/30 text-void-cyan hover:bg-void-cyan/10"
                onClick={() => { onClose(); navigateToPanel('agents') }}
              >
                Register your first agent
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-lg bg-void-cyan/5 border border-void-cyan/20 space-y-1.5">
                <p className="text-xs font-medium text-void-cyan">Available Now</p>
                <ul className="text-2xs text-muted-foreground space-y-1">
                  <li>Session monitoring — watch Claude Code in real-time</li>
                  <li>Task board — kanban-style work management</li>
                  <li>Cost tracking — token usage and spend per session</li>
                  <li>Session history — full log of past sessions</li>
                  <li>Security scanning — audit your installation</li>
                  <li>Diagnostics — health checks and system info</li>
                </ul>
              </div>
              <div className="p-3 rounded-lg bg-surface-1/50 border border-border/30 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">With Gateway</p>
                <ul className="text-2xs text-muted-foreground space-y-1">
                  <li>Agent orchestration — multi-agent coordination</li>
                  <li>Soul/personality — configure agent identity</li>
                  <li>Working memory — persistent agent context</li>
                  <li>Skills marketplace — extend capabilities</li>
                  <li>Wake/delegate — trigger agents on demand</li>
                  <li>Webhooks — outbound event notifications</li>
                </ul>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                if (capabilities.claudeSessions > 0) {
                  onClose(); navigateToPanel('claude')
                } else {
                  onClose(); navigateToPanel('gateways')
                }
              }}
            >
              {capabilities.claudeSessions > 0 ? 'View active sessions' : 'Configure Gateway'}
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs text-muted-foreground">Back</Button>
        <Button onClick={onNext} size="sm" className="bg-void-cyan/20 text-void-cyan border border-void-cyan/30 hover:bg-void-cyan/30">
          Continue
        </Button>
      </div>
    </>
  )
}

function FeatureItem({ label, desc }: { label: string; desc?: string }) {
  return (
    <div className="flex items-start gap-2 px-2.5 py-1.5 rounded bg-surface-1/50 border border-border/30">
      <span className="text-void-cyan text-xs font-mono mt-0.5 shrink-0">[+]</span>
      <div className="min-w-0">
        <span className="text-xs text-foreground">{label}</span>
        {desc && <p className="text-2xs text-muted-foreground">{desc}</p>}
      </div>
    </div>
  )
}

function StepSecurity({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <h2 className="text-lg font-semibold mb-1">Security Scan</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Since agents operate autonomously, security matters more than usual. This scan checks five areas:
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {['Credentials', 'Network', 'OpenClaw config', 'Runtime', 'OS hardening'].map(area => (
            <span key={area} className="text-2xs px-2 py-0.5 rounded-full bg-surface-1 border border-border/30 text-muted-foreground">{area}</span>
          ))}
        </div>
        <SecurityScanCard autoScan />
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs text-muted-foreground">Back</Button>
        <Button onClick={onNext} size="sm" className="bg-void-cyan/20 text-void-cyan border border-void-cyan/30 hover:bg-void-cyan/30">
          Continue
        </Button>
      </div>
    </>
  )
}

function StepNextSteps({
  isGateway,
  onFinish,
  onBack,
  navigateToPanel,
  onClose,
}: {
  isGateway: boolean
  onFinish: () => void
  onBack: () => void
  navigateToPanel: (panel: string) => void
  onClose: () => void
}) {
  const goTo = (panel: string) => { onClose(); navigateToPanel(panel) }

  const primaryAction = isGateway
    ? { label: 'Register your first agent', panel: 'agents', desc: 'Add agents through the dashboard or let them self-register via POST /api/agents with your API key' }
    : { label: 'View Claude sessions', panel: 'claude', desc: 'See active Claude Code sessions, their output, token usage, and cost in real-time' }

  const secondaryActions = [
    { label: 'Explore the task board', panel: 'tasks', desc: 'Kanban board to create, assign, and track work items across your agents and team' },
    { label: 'Browse the skills hub', panel: 'skills', desc: 'Install pre-built skills that extend what your agents can do — from code review to deployment' },
    { label: 'Configure webhooks', panel: 'webhooks', desc: 'Set up outbound HTTP notifications for agent events — completions, errors, and status changes' },
    { label: 'Review settings', panel: 'settings', desc: 'Manage data retention, scheduled backups, security policies, and system configuration' },
  ]

  return (
    <>
      <div className="flex-1">
        <h2 className="text-lg font-semibold mb-1">You&apos;re All Set</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Your station is ready. Pick where you&apos;d like to start — you can always reach everything from the sidebar.
        </p>

        <div className="space-y-2">
          {/* Primary CTA */}
          <button
            onClick={() => goTo(primaryAction.panel)}
            className="w-full flex items-start gap-3 p-3 rounded-lg border border-void-cyan/30 bg-void-cyan/5 hover:bg-void-cyan/10 transition-colors text-left"
          >
            <span className="text-void-cyan text-sm mt-0.5 font-mono">{'>'}</span>
            <div>
              <p className="text-sm font-medium text-void-cyan">{primaryAction.label}</p>
              <p className="text-xs text-muted-foreground">{primaryAction.desc}</p>
            </div>
          </button>

          {/* Secondary actions */}
          {secondaryActions.map(item => (
            <button
              key={item.panel}
              onClick={() => goTo(item.panel)}
              className="w-full flex items-start gap-3 p-3 rounded-lg border border-border/30 hover:border-void-cyan/30 hover:bg-surface-1/50 transition-colors text-left"
            >
              <span className="text-void-cyan text-sm mt-0.5">-{'>'}</span>
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground/60 mt-3 p-2 rounded-lg bg-surface-1/30 border border-border/20">
          Tip: Agents can self-register via POST /api/agents using the X-Api-Key header.
          Share the key with teammates so their agents can join your workspace automatically.
        </p>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border/30">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs text-muted-foreground">Back</Button>
        <Button onClick={onFinish} size="sm" className="bg-void-cyan/20 text-void-cyan border border-void-cyan/30 hover:bg-void-cyan/30">
          Finish Setup
        </Button>
      </div>
    </>
  )
}
