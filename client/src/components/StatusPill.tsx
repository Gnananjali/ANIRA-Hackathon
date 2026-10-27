import type { HealthState } from '../types';

const config = {
  online: {
    label: 'API online',
    dot: 'bg-mint',
    text: 'text-mint',
    ring: 'border-mint/30 bg-mint/[0.07]',
    animate: true,
  },
  offline: {
    label: 'API offline',
    dot: 'bg-rose',
    text: 'text-rose-300',
    ring: 'border-rose/30 bg-rose/[0.08]',
    animate: false,
  },
  checking: {
    label: 'Checking API',
    dot: 'bg-slate-500',
    text: 'text-slate-400',
    ring: 'border-line bg-white/[0.02]',
    animate: true,
  },
} as const;

export function StatusPill({ health }: { health: HealthState }) {
  const current = config[health.status];
  const checked = health.checkedAt
    ? new Date(health.checkedAt).toLocaleTimeString([], { hour12: false })
    : 'not yet';

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${current.ring} ${current.text}`}
      title={`${health.payload?.service ?? 'anira-server'} · v${health.payload?.version ?? '0.1.0'} · last check ${checked}`}
      aria-live="polite"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${current.dot} ${current.animate ? 'animate-pulse-dot' : ''}`}
      />
      {current.label}
      {health.status === 'online' && health.payload ? (
        <span className="tnum hidden font-mono text-[10px] text-slate-400 sm:inline">
          {health.payload.uptimeSeconds}s
        </span>
      ) : null}
    </span>
  );
}