const stages = [
  { label: 'Plan', state: 'Draft only', tone: 'text-mint border-mint/25 bg-mint/[0.05]' },
  { label: 'Approve', state: 'Gated', tone: 'text-sky-200 border-sky/25 bg-sky/[0.05]' },
  { label: 'Execute', state: 'Approval only', tone: 'text-sky-200 border-sky/25 bg-sky/[0.05]' },
  { label: 'Verify', state: 'Manual', tone: 'text-slate-500 border-line bg-white/[0.02]' },
  { label: 'Undo', state: 'Unavailable', tone: 'text-slate-500 border-line bg-white/[0.02]' },
];

export function PipelineStrip() {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {stages.map((stage, index) => (
        <li key={stage.label} className={`rounded-xl border px-3.5 py-3 ${stage.tone}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em]">
              {stage.label}
            </span>
            <span className="tnum font-mono text-[9.5px] text-slate-500">0{index + 1}</span>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">{stage.state}</p>
        </li>
      ))}
    </ol>
  );
}