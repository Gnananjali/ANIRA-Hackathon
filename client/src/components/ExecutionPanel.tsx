import type { PlanStep } from '../types';
import { Badge } from './Badge';
import { IconClock, IconLock } from './icons';
import { Panel } from './Panel';

export function ExecutionPanel({ plan }: { plan: PlanStep[] | null }) {
  const awaiting = Boolean(plan);

  const rows = [
    { label: 'Queue', value: awaiting ? 'Draft only — not queued' : 'Empty' },
    { label: 'Worker', value: 'Not available' },
    { label: 'Model calls', value: 'Disabled' },
    { label: 'Undo', value: 'Not available' },
  ];

  return (
    <Panel
      title="Execution"
      subtitle="Plan-run execution, separate from the approved check."
      badge={
        <Badge variant={awaiting ? 'info' : 'muted'}>
          {awaiting ? 'Awaiting approval' : 'Idle'}
        </Badge>
      }
    >
      <div className="flex items-center gap-3">
        <div
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${
            awaiting
              ? 'border-sky/25 bg-sky/[0.06] text-sky-200'
              : 'border-line bg-white/[0.02] text-slate-500'
          }`}
        >
          {awaiting ? <IconClock className="h-5 w-5" /> : <IconLock className="h-5 w-5" />}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-200">
            {awaiting ? 'Waiting on a human decision' : 'No run in progress'}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">
            {awaiting
              ? 'A draft exists, but plan-step approval and execution are not part of this milestone.'
              : 'Generate a draft plan to preview the execution surface.'}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-slate-500">
          <span>Execution progress</span>
          <span className="tnum font-mono">0%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
          <div className="h-full w-0 rounded-full bg-gradient-to-r from-mint to-sky" />
        </div>
      </div>

      <dl className="mt-4 space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 border-b border-line/50 pb-2 last:border-0 last:pb-0"
          >
            <dt className="text-[11px] text-slate-400">{row.label}</dt>
            <dd className="text-right font-mono text-[10px] text-slate-300">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}