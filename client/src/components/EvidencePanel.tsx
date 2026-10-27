import { useEffect, useState } from 'react';

import { formatDuration } from '../checkFormat';
import { shortHash } from '../editFormat';
import { evidenceHeaders } from '../evidenceSession';
import type {
  EvidenceEvent,
  EvidenceOutcome,
  EvidenceTimeline,
  EvidenceType,
} from '../types';
import { Badge, type BadgeVariant } from './Badge';
import { IconLock } from './icons';
import { Panel } from './Panel';

const TYPE_LABELS: Record<EvidenceType, string> = {
  inspection: 'Inspection',
  planning: 'Planning',
  approval: 'Approval',
  edit: 'Edit',
  verification: 'Verification',
  recovery: 'Recovery',
  failure: 'Failure',
};

const OUTCOME_VARIANTS: Record<EvidenceOutcome, BadgeVariant> = {
  planned: 'muted',
  approved: 'info',
  executed: 'info',
  verified: 'ok',
  failed: 'danger',
  blocked: 'demo',
  recovered: 'ok',
};

function summarize(event: EvidenceEvent): string {
  switch (event.type) {
    case 'inspection':
      return `${event.evidence.totalFiles} files scanned${
        event.evidence.truncated ? ' · truncated' : ''
      }`;
    case 'planning':
      return event.evidence.planner === 'deterministic'
        ? `Planner fallback${
            event.evidence.fallbackReason
              ? ` · ${event.evidence.fallbackReason}`
              : ''
          }`
        : `AI plan · ${event.evidence.stepCount} steps${
            event.evidence.fallbackReason
              ? ` · fallback: ${event.evidence.fallbackReason}`
              : ''
          }`;
    case 'approval': {
      const action =
        event.outcome === 'approved'
          ? 'Approved'
          : 'Prepared, not approved';
      return event.evidence.target === 'check'
        ? `${action} check ${event.evidence.checkId ?? ''}`
        : `${action} ${event.evidence.target} ${event.evidence.path ?? ''}`;
    }
    case 'edit':
      return `${event.evidence.path} · ${shortHash(event.evidence.beforeHash)} → ${shortHash(
        event.evidence.afterHash,
      )}`;
    case 'verification':
      return `${event.evidence.checkId} · exit ${
        event.evidence.exitCode ?? '—'
      }${event.evidence.timedOut ? ' · timed out' : ''} · ${formatDuration(
        event.evidence.durationMs,
      )}`;
    case 'recovery':
      return `${event.evidence.path}${
        event.evidence.restoredHash
          ? ` · restored ${shortHash(event.evidence.restoredHash)}`
          : ''
      }${event.evidence.verifiedHash ? ' · hash verified' : ''}`;
    case 'failure':
      return `${event.evidence.operation} · ${event.evidence.reason}`;
  }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="break-all text-right font-mono text-slate-300">{value}</dd>
    </div>
  );
}

function EvidenceDetails({ event }: { event: EvidenceEvent }) {
  switch (event.type) {
    case 'inspection':
      return (
        <dl className="space-y-1.5">
          <DetailRow label="Repository" value={event.evidence.repoName} />
          <DetailRow label="Files" value={String(event.evidence.totalFiles)} />
          <DetailRow
            label="Truncated"
            value={event.evidence.truncated ? 'yes' : 'no'}
          />
          <DetailRow
            label="Ignored"
            value={
              event.evidence.ignoredFolders.length > 0
                ? event.evidence.ignoredFolders.join(', ')
                : 'none'
            }
          />
          <DetailRow
            label="Stack"
            value={
              event.evidence.stack.length > 0
                ? event.evidence.stack.join(', ')
                : 'none'
            }
          />
          <DetailRow
            label="Languages"
            value={
              event.evidence.languages.length > 0
                ? event.evidence.languages
                    .map((language) => `${language.name} (${language.files})`)
                    .join(', ')
                : 'none'
            }
          />
        </dl>
      );

    case 'planning':
      return (
        <div className="space-y-2">
          <dl className="space-y-1.5">
            <DetailRow label="Planner" value={event.evidence.planner} />
            {event.evidence.model ? (
              <DetailRow label="Model" value={event.evidence.model} />
            ) : null}
            {event.evidence.fallbackReason ? (
              <DetailRow
                label="Fallback"
                value={event.evidence.fallbackReason}
              />
            ) : null}
            {event.evidence.inspected ? (
              <DetailRow
                label="Inspected"
                value={`${event.evidence.inspected.totalFiles} files${
                  event.evidence.inspected.truncated ? ' (truncated)' : ''
                }`}
              />
            ) : null}
          </dl>
          {event.evidence.steps.length > 0 ? (
            <div>
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Planned steps
              </p>
              <ul className="mt-1 space-y-1">
                {event.evidence.steps.map((step) => (
                  <li key={step.id} className="font-mono text-[10px] text-slate-400">
                    {step.id} · {step.action} · {step.risk}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );

    case 'approval':
      return (
        <dl className="space-y-1.5">
          <DetailRow label="Target" value={event.evidence.target} />
          {event.evidence.checkId ? (
            <DetailRow label="Check" value={event.evidence.checkId} />
          ) : null}
          {event.evidence.command ? (
            <DetailRow label="Command" value={event.evidence.command} />
          ) : null}
          {event.evidence.path ? (
            <DetailRow label="Path" value={event.evidence.path} />
          ) : null}
        </dl>
      );

    case 'edit':
      return (
        <dl className="space-y-1.5">
          <DetailRow label="Path" value={event.evidence.path} />
          <DetailRow label="Before" value={event.evidence.beforeHash} />
          <DetailRow label="After" value={event.evidence.afterHash} />
        </dl>
      );

    case 'verification':
      return (
        <div className="space-y-2">
          <dl className="space-y-1.5">
            <DetailRow label="Check" value={event.evidence.checkId} />
            <DetailRow label="Command" value={event.evidence.command} />
            <DetailRow
              label="Exit"
              value={event.evidence.exitCode === null ? 'none' : String(event.evidence.exitCode)}
            />
            <DetailRow
              label="Timed out"
              value={event.evidence.timedOut ? 'yes' : 'no'}
            />
            <DetailRow
              label="Duration"
              value={formatDuration(event.evidence.durationMs)}
            />
            <DetailRow
              label="Truncated"
              value={event.evidence.truncated ? 'yes' : 'no'}
            />
          </dl>
          <p className="text-[10px] leading-relaxed text-slate-500">
            This verifies one command, not every plan step.
          </p>
          {event.evidence.stdout.length > 0 ? (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-line/60 bg-ink/70 p-2 font-mono text-[9.5px] leading-relaxed text-slate-300">
              {event.evidence.stdout}
            </pre>
          ) : null}
          {event.evidence.stderr.length > 0 ? (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-rose/20 bg-rose/[0.04] p-2 font-mono text-[9.5px] leading-relaxed text-rose-200">
              {event.evidence.stderr}
            </pre>
          ) : null}
        </div>
      );

    case 'recovery':
      return (
        <dl className="space-y-1.5">
          <DetailRow label="Path" value={event.evidence.path} />
          {event.evidence.restoredHash ? (
            <DetailRow label="Restored" value={event.evidence.restoredHash} />
          ) : null}
          {event.evidence.afterHash ? (
            <DetailRow label="Previous" value={event.evidence.afterHash} />
          ) : null}
          <DetailRow
            label="Hash verified"
            value={event.evidence.verifiedHash ? 'yes' : 'no'}
          />
        </dl>
      );

    case 'failure':
      return (
        <dl className="space-y-1.5">
          <DetailRow label="Operation" value={event.evidence.operation} />
          <DetailRow label="Reason" value={event.evidence.reason} />
        </dl>
      );
  }
}

export function EvidencePanel({ refreshKey }: { refreshKey: number }) {
  const [timeline, setTimeline] = useState<EvidenceTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        const response = await fetch('/api/evidence', {
          headers: evidenceHeaders({ Accept: 'application/json' }),
        });

        if (!response.ok) {
          throw new Error('evidence_unavailable');
        }

        const payload = (await response.json()) as EvidenceTimeline;
        if (!cancelled) {
          setTimeline(payload);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError('Evidence is unavailable. The server may be offline.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const events = timeline ? [...timeline.events].reverse() : [];
  const sessionLabel = timeline ? timeline.sessionId.slice(0, 8) : '—';

  return (
    <Panel
      title="Proof of Work"
      subtitle="Server-recorded evidence from this browser session. Read-only."
      badge={
        <span className="flex items-center gap-1.5">
          <Badge variant="info">Read-only</Badge>
          <Badge variant="muted">{events.length}</Badge>
        </span>
      }
      bodyClassName="px-5 py-4"
    >
      {loading && !timeline ? (
        <div className="flex items-center gap-3 rounded-lg border border-line/70 bg-white/[0.015] px-3 py-4">
          <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse-dot" />
          <p className="text-[11px] text-slate-400">Loading evidence…</p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-rose/25 bg-rose/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-rose-200"
        >
          {error}
        </p>
      ) : null}

      {!loading && !error && events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line/80 px-4 py-6 text-center">
          <p className="text-[12px] text-slate-300">No evidence recorded yet</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
            Inspect a folder, generate a plan, or run an approved check or edit.
          </p>
        </div>
      ) : null}

      {events.length > 0 ? (
        <ul className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {events.map((event) => (
            <li
              key={event.id}
              className="rounded-lg border border-line/60 bg-white/[0.015] px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="muted">{TYPE_LABELS[event.type]}</Badge>
                <Badge variant={OUTCOME_VARIANTS[event.outcome]}>
                  {event.outcome}
                </Badge>
                <time className="tnum ml-auto font-mono text-[9.5px] text-slate-500">
                  {new Date(event.at).toLocaleTimeString([], { hour12: false })}
                </time>
              </div>
              <p className="mt-1.5 font-mono text-[9.5px] text-slate-500">
                {event.operation}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
                {summarize(event)}
              </p>
              {event.reason ? (
                <p className="mt-0.5 text-[10px] text-amber-200">
                  Reason: {event.reason}
                </p>
              ) : null}
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[9.5px] uppercase tracking-[0.12em] text-slate-500">
                  Evidence
                </summary>
                <div className="mt-1.5 rounded-md border border-line/50 bg-ink/40 p-2 text-[10px] leading-relaxed">
                  <EvidenceDetails event={event} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex items-start gap-2 border-t border-line/60 pt-3">
        <IconLock className="mt-0.5 h-3 w-3 shrink-0 text-slate-600" />
        <p className="text-[9.5px] leading-relaxed text-slate-500">
          {timeline?.note ??
            'In-memory evidence only. Events are lost on server restart and are not tamper-proof or durable audit storage.'}
          {timeline
            ? ` Session ${sessionLabel}. Up to ${timeline.limits.maxEventsPerSession} events; output capped at ${timeline.limits.maxOutputBytes} bytes per stream.`
            : ''}
        </p>
      </div>
    </Panel>
  );
}