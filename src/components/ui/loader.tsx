'use client'

interface LoaderProps {
  variant?: 'page' | 'panel' | 'inline'
  label?: string
}

function LoaderDots({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dotSize = size === 'sm' ? 'w-1 h-1' : 'w-1.5 h-1.5'
  return (
    <div className="flex items-center gap-1.5">
      <div className={`${dotSize} rounded-full bg-void-cyan animate-pulse`} style={{ animationDelay: '0ms' }} />
      <div className={`${dotSize} rounded-full bg-void-cyan animate-pulse`} style={{ animationDelay: '200ms' }} />
      <div className={`${dotSize} rounded-full bg-void-cyan animate-pulse`} style={{ animationDelay: '400ms' }} />
    </div>
  )
}

export function Loader({ variant = 'panel', label }: LoaderProps) {
  if (variant === 'page') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-6">
          <div className="relative">
            <div className="absolute -inset-3 rounded-2xl bg-primary/10 blur-xl animate-glow-pulse" />
            <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-surface-1 border border-border/50 flex items-center justify-center shadow-lg shadow-primary/5">
              <img src="/brand/mc-logo-128.png" alt="Mission Control logo" className="w-full h-full object-cover" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-3">
            <LoaderDots />
            {label !== undefined ? (
              label && <span className="text-sm text-muted-foreground font-medium tracking-wide">{label}</span>
            ) : (
              <span className="text-sm text-muted-foreground font-medium tracking-wide">Loading Mission Control</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2">
        <LoaderDots size="sm" />
        {label && <span className="text-sm text-muted-foreground">{label}</span>}
      </div>
    )
  }

  // panel (default)
  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex flex-col items-center gap-3">
        <LoaderDots />
        {label && <span className="text-sm text-muted-foreground">{label}</span>}
      </div>
    </div>
  )
}
