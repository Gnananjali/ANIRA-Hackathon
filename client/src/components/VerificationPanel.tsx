import { useEffect, useState } from 'react';

import { exitLabel, formatDuration, isCheckPassed } from '../checkFormat';
import type { ActivityKind, CheckPreparation, CheckRunResult } from '../types';
import { Badge } from './Badge';
import { IconAlert, IconCheck, IconClock, IconLock, IconTerminal } from './icons';
import { Panel } from './Panel';

type Phase = 'idle' | 'preparing' | 'prepared' | 'running' | 'done' | 'error';

const UNAVAILABLE_REASONS: Record<string, string> = {
  missing_manifest: 'No package.json was found in the selected folder.',
  invalid_manifest: 'package.json could not be parsed.',
  missing_script: 'package.json has no test script to run.',
  npm_not_found: 'npm could not be located on this machine.',
  unsupported_platform: 'The project check is Windows-only in this build.',
};

const ERROR_MESSAGES: Record<string, string> = {
  check_not_found: 'Unknown project check.',
  approval_expired: 'The approval expired. Prepare the check again.',
  approval_invalid: 'That approval is no longer valid. Prepare the check again.',
  run_in_progress: 'A check is already running.',
  approval_header_required: 'Request blocked by the approval guard.',
  origin_not_allowed: 'Request blocked by the approval guard.',
  check_failed_to_start: 'The check could not be started.',
};

function describeFailure(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'The check request failed.';
  }

  const record = payload as { error?: unknown; reason?: unknown };
  const code = typeof record.error === 'string' ? record.error : '';
  const reason = typeof record.reason === 'string' ? record.reason : '';

  if (code === 'check_unavailable' && reason) {
    return UNAVAILABLE_REASONS[reason] ?? 'This check is not available for that folder.';
  }

  return ERROR_MESSAGES[code] ?? 'The check request failed.';
}

function OutputBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line/60 bg-ink/70 p-2.5 font-mono text-[10px] leading-relaxed text-slate-300">
        {value.length > 0 ? value : '(no output)'}
      </pre>
    </div>
  );
}

interface VerificationPanelProps {
  root: string | null;
  onLog: (kind: ActivityKind, message: string) => void;
}

export function VerificationPanel({ root, onLog }: VerificationPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [preparation, setPreparation] = useState<CheckPreparation | null>(null);
  const [result, setResult] = useState<CheckRunResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPhase('idle');
    setPreparation(null);
    setResult(null);
    setMessage(null);
  }, [root]);

  function reset() {
    setPhase('idle');
    setPreparation(null);
    setResult(null);
    setMessage(null);
  }

  async function handlePrepare() {
    if (!root || phase === 'preparing' || phase === 'running') {
      return;
    }

    setPhase('preparing');
    setMessage(null);
    setResult(null);

    try {
      const response = await fetch('/api/checks/prepare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ANIRA-Approval': '1',
        },
        body: JSON.stringify({ root, checkId: 'node-test' }),
      });

      const payload = (await response.json().catch(() => null)) as
        | CheckPreparation
        | Record<string, unknown>
        | null;

      if (!response.ok) {
        setPhase('error');
        setMessage(describeFailure(payload));
        onLog('system', 'Check preparation failed.');
        return;
      }

      setPreparation(payload as CheckPreparation);
      setPhase('prepared');
      onLog('system', 'Prepared the npm test check. Nothing has run yet.');
    } catch {
      setPhase('error');
      setMessage('Could not reach the checks API.');
      onLog('system', 'Check preparation failed (network).');
    }
  }

  async function handleApprove() {
    if (!preparation || phase === 'running') {
      return;
    }

    setPhase('running');
    setMessage(null);

    try {
      const response = await fetch('/api/checks/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ANIRA-Approval': '1',
        },
        body: JSON.stringify({ approvalId: preparation.approvalId }),
      });

      const payload = (await response.json().catch(() => null)) as
        | CheckRunResult
        | Record<string, unknown>
        | null;

      if (!response.ok) {
        setPhase('error');
        setMessage(describeFailure(payload));
        setPreparation(null);
        onLog('system', 'The approved check did not run.');
        return;
      }

      const runResult = payload as CheckRunResult;
      setResult(runResult);
      setPreparation(null);
      setPhase('done');

      if (runResult.timedOut) {
        onLog(
          'system',
          `Check ${runResult.checkId} was interrupted after ${formatDuration(runResult.durationMs)} (time limit).`,
        );
      } else {
        onLog(
          'system',
          `Check ${runResult.checkId} exited ${runResult.exitCode} in ${formatDuration(runResult.durationMs)}.`,
        );
      }
    } catch {
      setPhase('error');
      setPreparation(null);
      setMessage('Could not reach the checks API. The approval may already be used.');
      onLog('system', 'The approved check did not run (network).');
    }
  }

  const passed = result ? isCheckPassed(result.exitCode, result.timedOut) : false;
  const busy = phase === 'preparing' || phase === 'running';
  const showPrepare = phase === 'idle' || phase === 'preparing' || phase === 'error';

  const badge =
    phase === 'done' && result ? (
      <Badge variant={passed ? 'ok' : 'danger'}>
        {passed ? 'Exit 0' : exitLabel(result.exitCode, result.timedOut)}
      </Badge>
    ) : phase === 'prepared' ? (
      <Badge variant="info">Prepared</Badge>
    ) : phase === 'running' ? (
      <Badge variant="info">Running</Badge>
    ) : phase === 'error' ? (
      <Badge variant="danger">Error</Badge>
    ) : (
      <Badge variant="muted">Manual</Badge>
    );

  return (
    <Panel
      title="Verification"
      subtitle="One allowlisted check. Nothing runs without your approval."
      badge={badge}
    >
      {!root ? (
        <div className="rounded-xl border border-dashed border-line/80 px-4 py-6 text-center">
          <p className="text-[12px] text-slate-300">No folder inspected</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
            Inspect a project folder to enable the npm test check.
          </p>
        </div>
      ) : null}

      {root && showPrepare ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-line/70 bg-white/[0.015] p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[12px] font-medium text-slate-200">Run project tests</p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
                  The server maps this check to one fixed command.
                </p>
              </div>
              <Badge variant="muted">node-test</Badge>
            </div>
            <div className="mt-2 flex items-center gap-1.5 rounded-md border border-line bg-ink/60 px-2 py-1 font-mono text-[10.5px] text-slate-300">
              <IconTerminal className="h-3 w-3" />
              npm test
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber/25 bg-amber/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-amber-100">
            <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
            <p>
              This runs the project’s own <span className="font-mono">npm test</span> script. It
              executes repository code and may create or modify files. ANIRA itself does not edit
              files.
            </p>
          </div>

          {message ? (
            <div
              role="alert"
              className="rounded-lg border border-rose/25 bg-rose/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-rose-200"
            >
              {message}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void handlePrepare()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-mint/30 bg-mint/15 px-3 py-1.5 text-[11px] font-semibold text-mint transition-colors hover:bg-mint/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-white/[0.02] disabled:text-slate-600"
          >
            <IconLock className="h-3.5 w-3.5" />
            {phase === 'preparing' ? 'Preparing…' : 'Prepare check'}
          </button>
        </div>
      ) : null}

      {root && phase === 'prepared' && preparation ? (
        <div className="space-y-3 animate-fade-up">
          <div className="rounded-xl border border-sky/25 bg-sky/[0.04] p-3.5">
            <div className="flex items-center gap-2 text-sky-200">
              <IconClock className="h-3.5 w-3.5" />
              <p className="text-[12px] font-medium">Ready for approval</p>
            </div>

            <dl className="mt-2.5 space-y-1.5 text-[10.5px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Command</dt>
                <dd className="font-mono text-slate-300">{preparation.check.command}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Folder</dt>
                <dd className="truncate font-mono text-slate-400" title={preparation.root}>
                  {preparation.root}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Approval expires</dt>
                <dd className="tnum font-mono text-slate-400">
                  {new Date(preparation.expiresAt).toLocaleTimeString([], { hour12: false })}
                </dd>
              </div>
            </dl>
          </div>

          <p className="text-[10.5px] leading-relaxed text-amber-100/90">
            Approving runs this one command once. It executes repository code and may modify files.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleApprove()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber/35 bg-amber/15 px-3 py-1.5 text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-white/[0.02] disabled:text-slate-600"
            >
              <IconCheck className="h-3.5 w-3.5" />
              Approve &amp; run
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {root && phase === 'running' ? (
        <div className="flex items-center gap-3 rounded-xl border border-line/70 bg-white/[0.015] px-3.5 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400 animate-pulse-dot" />
          <div>
            <p className="text-[12px] text-slate-200">Running npm test…</p>
            <p className="mt-0.5 text-[10.5px] text-slate-500">
              Output appears when the command finishes. It is not streamed.
            </p>
          </div>
        </div>
      ) : null}

      {root && phase === 'done' && result ? (
        <div className="space-y-3 animate-fade-up">
          <div
            className={`flex items-center justify-between gap-2 rounded-xl border p-3.5 ${
              passed
                ? 'border-mint/25 bg-mint/[0.04]'
                : 'border-rose/25 bg-rose/[0.05]'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                  passed
                    ? 'border-mint/30 bg-mint/10 text-mint'
                    : 'border-rose/30 bg-rose/10 text-rose-300'
                }`}
              >
                {passed ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p
                  className={`font-mono text-[13px] font-semibold ${
                    passed ? 'text-mint' : 'text-rose-300'
                  }`}
                >
                  {exitLabel(result.exitCode, result.timedOut)}
                </p>
                <p className="mt-0.5 text-[10.5px] text-slate-500">
                  {result.timedOut
                    ? 'Run interrupted by the time limit.'
                    : passed
                      ? 'The command exited cleanly.'
                      : 'The command exited with a failure code.'}
                </p>
              </div>
            </div>
            <span className="tnum shrink-0 font-mono text-[10px] text-slate-500">
              {formatDuration(result.durationMs)}
            </span>
          </div>

          <p className="text-[10px] leading-relaxed text-slate-500">
            Actual result from one approved run of{' '}
            <span className="font-mono">npm test</span>. Nothing else was executed.
          </p>

          <OutputBlock label="stdout" value={result.stdout} />
          <OutputBlock label="stderr" value={result.stderr} />

          {result.truncated ? (
            <p className="rounded-lg border border-amber/20 bg-amber/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-amber-200">
              Output was truncated at the capture limit.
            </p>
          ) : null}

          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
          >
            Run again
          </button>
        </div>
      ) : null}
    </Panel>
  );
}