import type { PlanStep } from '../types';
import { Badge } from './Badge';
import { IconLock } from './icons';
import { Panel } from './Panel';

export function ExecutionPanel({ plan }: { plan: PlanStep[] | null }) {
  const rows = [
    { label: 'Plan', value: plan ? `${plan.length} proposed steps` : 'No draft' },
    { label: 'Queue', value: 'Not queued' },
    { label: 'Worker', value: 'Not available' },
    { label: 'Execution model calls', value: 'Disabled' },
    { label: 'Undo', value: 'Not applicable — no changes' },
  ];

  return (
    <Panel
      title="Plan execution"
      subtitle="Proposed plan steps are not executable in this milestone."
      badge={<Badge variant="muted">Not implemented</Badge>}
    >
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.02] text-slate-500">
          <IconLock className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-200">No plan execution</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">
            Plan steps do not run. The project check and Controlled edit run only after approval.
          </p>
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