import type { PlanReport, Risk } from '../types';
import { Badge } from './Badge';
import { IconFile, IconLock, IconTerminal } from './icons';
import { Panel } from './Panel';

const riskStyles: Record<Risk, string> = {
  low: 'border-mint/25 bg-mint/[0.06] text-mint',
  medium: 'border-amber/25 bg-amber/[0.06] text-amber-200',
  high: 'border-rose/25 bg-rose/[0.06] text-rose-300',
};

export function PlanPanel({ report }: { report: PlanReport | null }) {
  const plan = report?.steps ?? null;
  const readOnly = Boolean(plan && plan.length > 0 && plan.every((step) => step.kind === 'read'));
  const findings = report ? [...report.facts, ...report.inferences] : [];

  return (
    <Panel
      title="Plan report"
      subtitle={
        report?.inspected
          ? `Grounded in ${report.inspected.name} · ${report.inspected.totalFiles} files scanned.`
          : 'A draft sequence for review. Nothing here has been approved.'
      }
      badge={
        plan ? (
          readOnly ? (
            <Badge variant="ok">Read-only</Badge>
          ) : (
            <Badge variant="demo">Draft</Badge>
          )
        ) : (
          <Badge variant="muted">Empty</Badge>
        )
      }
      action={
        <span className="font-mono text-[11px] text-slate-600">
          {plan ? `${plan.length} steps` : '—'}
        </span>
      }
      bodyClassName="px-5 py-4"
    >
      {report && findings.length > 0 ? (
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Findings
            </p>
            <span className="text-[10px] text-slate-500">facts vs inferences</span>
          </div>

          <ul className="mt-2 space-y-2">
            {findings.map((finding) => (
              <li
                key={`${finding.basis}-${finding.label}`}
                className="rounded-lg border border-line/60 bg-white/[0.015] px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={finding.basis === 'fact' ? 'ok' : 'info'}>
                    {finding.basis}
                  </Badge>
                  <p className="text-[11.5px] font-medium text-slate-200">{finding.label}</p>
                </div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-slate-400">
                  {finding.detail}
                </p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-slate-300">
                  <span className="text-slate-500">What this means: </span>
                  {finding.meaning}
                </p>
                {finding.evidence.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {finding.evidence.map((path) => (
                      <span
                        key={path}
                        className="rounded border border-line/60 bg-ink/60 px-1.5 py-0.5 font-mono text-[9.5px] text-slate-400"
                      >
                        {path}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="mt-3 border-t border-line/60 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Planned actions
            </p>
          </div>
        </div>
      ) : null}

      {report && report.limitations.length > 0 ? (
        <div className="mb-4 rounded-lg border border-line/50 bg-white/[0.01] px-3 py-2">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Limits
          </p>
          <ul className="mt-1 space-y-1">
            {report.limitations.map((limitation) => (
              <li
                key={limitation}
                className="text-[10px] leading-relaxed text-slate-500"
              >
                · {limitation}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan && plan.length > 0 ? (
        <ol className="space-y-3 animate-fade-up">
          {plan.map((step, index) => (
            <li
              key={step.id}
              className="group rounded-xl border border-line/70 bg-white/[0.015] p-3.5 transition-colors hover:border-line"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line bg-ink/80 font-mono text-[10px] text-slate-400">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[13px] font-medium text-slate-200">{step.title}</h3>
                    <span className="rounded-full border border-line px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-slate-400">
                      Proposed
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-slate-400">{step.detail}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ink/60 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                      <IconTerminal className="h-3 w-3" />
                      {step.tool}
                    </span>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize ${riskStyles[step.risk]}`}
                    >
                      {step.risk} risk
                    </span>
                  </div>
                  {step.evidence && step.evidence.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {step.evidence.map((path) => (
                        <span
                          key={path}
                          className="rounded border border-line/60 bg-ink/60 px-1.5 py-0.5 font-mono text-[9.5px] text-slate-400"
                        >
                          {path}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line/80 px-6 py-10 text-center">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-white/[0.02] text-slate-500">
            <IconFile className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm text-slate-300">No plan drafted yet</p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
            Inspect a folder, then write a task brief and generate a draft to ground the plan in
            real files.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t border-line/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
          <IconLock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" />
          {report ? `${report.note} ` : ''}
          Plan-step approval and execution are not implemented in this milestone.
        </p>
        <button
          type="button"
          disabled
          title="Execution is not implemented in the scaffold milestone"
          className="inline-flex shrink-0 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-1.5 text-[11px] font-semibold text-slate-600"
        >
          <IconLock className="h-3.5 w-3.5" />
          Approve &amp; execute
        </button>
      </div>
    </Panel>
  );
}