import { IconAlert, IconLock } from './icons';

interface PlannerConsentProps {
  model?: string;
  onAllow: () => void;
  onUseLocal: () => void;
  onCancel: () => void;
}

export function PlannerConsent({
  model,
  onAllow,
  onUseLocal,
  onCancel,
}: PlannerConsentProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-void/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="planner-consent-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-line bg-panel p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-amber/30 bg-amber/10 text-amber-200">
            <IconAlert className="h-4 w-4" />
          </span>
          <div>
            <h2
              id="planner-consent-title"
              className="text-[15px] font-semibold text-slate-100"
            >
              Send repository metadata to an external AI provider?
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              AI planning sends limited data to the configured external provider. Nothing is sent
              until you allow it.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-line/60 bg-white/[0.015] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            What is sent
          </p>
          <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-slate-300">
            <li>· the task brief and the constraints derived from it</li>
            <li>· the repository name, total file count, and scan-truncation flag</li>
            <li>· repository stack signals and language counts</li>
            <li>· ignored-folder information</li>
            <li>· up to 200 file paths</li>
          </ul>
          <p className="mt-2 text-[11px] font-medium text-mint">
            File contents are not sent.
          </p>
        </div>

        {model ? (
          <p className="mt-3 text-[10.5px] text-slate-500">
            Configured model: <span className="font-mono text-slate-300">{model}</span>
          </p>
        ) : null}

        <p className="mt-2 flex items-start gap-2 text-[10px] leading-relaxed text-slate-500">
          <IconLock className="mt-0.5 h-3 w-3 shrink-0" />
          Consent is remembered for this browser session only. Closing the tab or starting a new
          session asks again.
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onAllow}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-mint/30 bg-mint/15 px-3 py-2 text-[11px] font-semibold text-mint transition-colors hover:bg-mint/20"
          >
            Allow for this session
          </button>
          <button
            type="button"
            onClick={onUseLocal}
            className="inline-flex flex-1 items-center justify-center rounded-lg border border-line px-3 py-2 text-[11px] font-medium text-slate-300 transition-colors hover:border-slate-600"
          >
            Use local planner
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:text-slate-300"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}