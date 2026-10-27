import type { StageTone, WorkflowStage } from '../workflow';

const toneStyles: Record<StageTone, string> = {
  mint: 'text-mint border-mint/25 bg-mint/[0.05]',
  sky: 'text-sky-200 border-sky/25 bg-sky/[0.05]',
  muted: 'text-slate-500 border-line bg-white/[0.02]',
  rose: 'text-rose-300 border-rose/25 bg-rose/[0.05]',
};

export function PipelineStrip({ stages }: { stages: WorkflowStage[] }) {
  return (
    <ol aria-label="Workflow stages" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {stages.map((stage, index) => (
        <li key={stage.id} className={`rounded-xl border px-3 py-3 ${toneStyles[stage.tone]}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">
              {stage.label}
            </span>
            <span className="tnum font-mono text-[9.5px] text-slate-500">
              0{index + 1}
            </span>
          </div>
          <p className="mt-1.5 text-[10.5px] leading-snug text-slate-400">{stage.state}</p>
        </li>
      ))}
    </ol>
  );
}