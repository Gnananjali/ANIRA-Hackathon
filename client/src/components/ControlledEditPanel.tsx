import { useEffect, useState } from 'react';

import { describeEditFailure, shortHash } from '../editFormat';
import { evidenceHeaders } from '../evidenceSession';
import type {
  ActivityKind,
  EditApplyResult,
  EditDiff,
  EditPreparation,
} from '../types';
import { Badge } from './Badge';
import { IconAlert, IconCheck, IconFile, IconLock } from './icons';
import { Panel } from './Panel';

type Phase =
  | 'idle'
  | 'previewing'
  | 'previewed'
  | 'applying'
  | 'applied'
  | 'rolling'
  | 'rolledback'
  | 'error';

const HEADERS = {
  'Content-Type': 'application/json',
  'X-ANIRA-Approval': '1',
};

function approvalHeaders(): Record<string, string> {
  return evidenceHeaders(HEADERS);
}

function DiffView({ diff }: { diff: EditDiff }) {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-line/60 bg-ink/70 p-2.5 font-mono text-[10px] leading-relaxed">
      {diff.contextBefore.map((line, index) => (
        <div key={`cb-${index}`} className="text-slate-500">
          {'  '}
          {line.length > 0 ? line : ' '}
        </div>
      ))}
      {diff.removed.map((line, index) => (
        <div key={`rm-${index}`} className="bg-rose/10 text-rose-300">
          {'- '}
          {line.length > 0 ? line : ' '}
        </div>
      ))}
      {diff.added.map((line, index) => (
        <div key={`ad-${index}`} className="bg-mint/10 text-mint">
          {'+ '}
          {line.length > 0 ? line : ' '}
        </div>
      ))}
      {diff.contextAfter.map((line, index) => (
        <div key={`ca-${index}`} className="text-slate-500">
          {'  '}
          {line.length > 0 ? line : ' '}
        </div>
      ))}
    </div>
  );
}

interface ControlledEditPanelProps {
  root: string | null;
  onLog: (kind: ActivityKind, message: string) => void;
}

export function ControlledEditPanel({ root, onLog }: ControlledEditPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [filePath, setFilePath] = useState('');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [preparation, setPreparation] = useState<EditPreparation | null>(null);
  const [applied, setApplied] = useState<EditApplyResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPhase('idle');
    setPreparation(null);
    setApplied(null);
    setMessage(null);
  }, [root]);

  function reset() {
    setPhase('idle');
    setPreparation(null);
    setApplied(null);
    setMessage(null);
  }

  async function handlePreview() {
    if (!root || phase === 'previewing' || phase === 'applying' || phase === 'rolling') {
      return;
    }

    setPhase('previewing');
    setMessage(null);
    setApplied(null);

    try {
      const response = await fetch('/api/edits/prepare', {
        method: 'POST',
        headers: approvalHeaders(),
        body: JSON.stringify({
          root,
          path: filePath.trim(),
          find,
          replace,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | EditPreparation
        | Record<string, unknown>
        | null;

      if (!response.ok) {
        setPhase('error');
        setMessage(describeEditFailure(payload));
        onLog('system', 'Edit preview failed. Nothing was written.');
        return;
      }

      setPreparation(payload as EditPreparation);
      setPhase('previewed');
      onLog(
        'system',
        `Previewed an edit for ${(payload as EditPreparation).path}. Nothing written.`,
      );
    } catch {
      setPhase('error');
      setMessage('Could not reach the edit API.');
      onLog('system', 'Edit preview failed (network).');
    }
  }

  async function handleApply() {
    if (!preparation || phase === 'applying') {
      return;
    }

    setPhase('applying');
    setMessage(null);

    try {
      const response = await fetch('/api/edits/apply', {
        method: 'POST',
        headers: approvalHeaders(),
        body: JSON.stringify({ editId: preparation.editId }),
      });

      const payload = (await response.json().catch(() => null)) as
        | EditApplyResult
        | Record<string, unknown>
        | null;

      if (!response.ok) {
        setPhase('error');
        setMessage(describeEditFailure(payload));
        setPreparation(null);
        onLog('system', 'Edit was not applied. Nothing was written.');
        return;
      }

      const result = payload as EditApplyResult;
      setApplied(result);
      setPreparation(null);
      setPhase('applied');
      onLog(
        'system',
        `Applied an edit to ${result.path} (${shortHash(result.beforeHash)} â†’ ${shortHash(
          result.afterHash,
        )}).`,
      );
    } catch {
      setPhase('error');
      setPreparation(null);
      setMessage('Could not reach the edit API. The preview may already be used.');
      onLog('system', 'Edit was not applied (network).');
    }
  }

  async function handleRollback() {
    if (!applied || phase === 'rolling') {
      return;
    }

    setPhase('rolling');
    setMessage(null);

    try {
      const response = await fetch('/api/edits/rollback', {
        method: 'POST',
        headers: approvalHeaders(),
        body: JSON.stringify({ rollbackId: applied.rollbackId }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            rolledBack: true;
            path: string;
            restoredHash: string;
            verifiedHash?: unknown;
          }
        | Record<string, unknown>
        | null;

      if (!response.ok) {
        setPhase('error');
        setMessage(describeEditFailure(payload));
        setApplied(null);
        onLog('system', 'Rollback failed. The file was left as-is.');
        return;
      }

      const result = payload as {
        path?: unknown;
        restoredHash?: unknown;
        verifiedHash?: unknown;
      };

      if (
        typeof result.path !== 'string' ||
        typeof result.restoredHash !== 'string' ||
        result.verifiedHash !== true
      ) {
        setPhase('error');
        setApplied(null);
        setMessage(
          'The server did not confirm the restored file SHA-256 hash. Review the file before retrying.',
        );
        onLog('system', 'Rollback was not confirmed as hash-verified.');
        return;
      }

      setApplied(null);
      setPhase('rolledback');
      onLog(
        'system',
        `Rolled back ${result.path} to ${shortHash(result.restoredHash)} (SHA-256 verified).`,
      );
    } catch {
      setPhase('error');
      setApplied(null);
      setMessage('Could not reach the edit API.');
      onLog('system', 'Rollback failed (network).');
    }
  }

  const busy = phase === 'previewing' || phase === 'applying' || phase === 'rolling';
  const showForm = phase === 'idle' || phase === 'previewing' || phase === 'error';

  const badge =
    phase === 'previewed' ? (
      <Badge variant="info">Preview</Badge>
    ) : phase === 'applying' ? (
      <Badge variant="info">Applying</Badge>
    ) : phase === 'applied' ? (
      <Badge variant="ok">Applied</Badge>
    ) : phase === 'rolling' ? (
      <Badge variant="info">Undoing</Badge>
    ) : phase === 'rolledback' ? (
      <Badge variant="ok">Undone</Badge>
    ) : phase === 'error' ? (
      <Badge variant="danger">Error</Badge>
    ) : (
      <Badge variant="muted">Manual</Badge>
    );

  return (
    <Panel
      title="Controlled edit"
      subtitle="One existing UTF-8 file. Server-generated diff. Nothing is written until you approve."
      badge={badge}
    >
      {!root ? (
        <div className="rounded-xl border border-dashed border-line/80 px-4 py-6 text-center">
          <p className="text-[12px] text-slate-300">No folder inspected</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
            Inspect a project folder before editing a file.
          </p>
        </div>
      ) : null}

      {root && showForm ? (
        <div className="space-y-3">
          <div>
            <label
              htmlFor="edit-path"
              className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Relative file path
            </label>
            <input
              id="edit-path"
              type="text"
              value={filePath}
              onChange={(event) => setFilePath(event.target.value)}
              placeholder="README.md"
              spellCheck={false}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-line/80 bg-ink/60 px-3 py-2 font-mono text-[11.5px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus-visible:border-mint/40"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="edit-find"
                className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Text to replace (must be unique)
              </label>
              <textarea
                id="edit-find"
                rows={3}
                value={find}
                onChange={(event) => setFind(event.target.value)}
                spellCheck={false}
                className="mt-1 w-full resize-y rounded-lg border border-line/80 bg-ink/60 px-3 py-2 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus-visible:border-mint/40"
              />
            </div>
            <div>
              <label
                htmlFor="edit-replace"
                className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Replacement text
              </label>
              <textarea
                id="edit-replace"
                rows={3}
                value={replace}
                onChange={(event) => setReplace(event.target.value)}
                spellCheck={false}
                className="mt-1 w-full resize-y rounded-lg border border-line/80 bg-ink/60 px-3 py-2 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus-visible:border-mint/40"
              />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber/25 bg-amber/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-amber-100">
            <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
            <p>
              One existing text file only. The server generates the diff and revalidates the file
              before writing. Original bytes are kept in memory for 10 minutes; a server restart
              invalidates undo.
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
            onClick={() => void handlePreview()}
            disabled={busy || filePath.trim().length === 0 || find.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-mint/30 bg-mint/15 px-3 py-1.5 text-[11px] font-semibold text-mint transition-colors hover:bg-mint/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-white/[0.02] disabled:text-slate-600"
          >
            <IconFile className="h-3.5 w-3.5" />
            {phase === 'previewing' ? 'Building previewâ€¦' : 'Preview change'}
          </button>
        </div>
      ) : null}

      {root && phase === 'previewed' && preparation ? (
        <div className="space-y-3 animate-fade-up">
          <div className="rounded-xl border border-line/70 bg-white/[0.015] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-[11.5px] text-slate-200">
                  {preparation.path}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Line {preparation.diff.startLine}, column {preparation.diff.startColumn} Â·{' '}
                  {preparation.diff.lineEnding} line endings
                </p>
              </div>
              <Badge variant="info">Diff</Badge>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[9.5px] text-slate-500">
              <span>{shortHash(preparation.beforeHash)}</span>
              <span>â†’</span>
              <span>{shortHash(preparation.afterHash)}</span>
            </div>
          </div>

          <DiffView diff={preparation.diff} />

          <div className="flex items-start gap-2 rounded-lg border border-amber/25 bg-amber/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-amber-100">
            <IconLock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
            <p>
              Applying writes exactly this one file. The server re-checks the file hash first and
              refuses if it changed. Undo is in memory only and expires after 10 minutes.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber/35 bg-amber/15 px-3 py-1.5 text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-white/[0.02] disabled:text-slate-600"
            >
              <IconCheck className="h-3.5 w-3.5" />
              Approve &amp; apply
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

      {root && phase === 'applying' ? (
        <div className="flex items-center gap-3 rounded-xl border border-line/70 bg-white/[0.015] px-3.5 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400 animate-pulse-dot" />
          <div>
            <p className="text-[12px] text-slate-200">Applying the approved editâ€¦</p>
            <p className="mt-0.5 text-[10.5px] text-slate-500">
              The file is revalidated immediately before writing.
            </p>
          </div>
        </div>
      ) : null}

      {root && phase === 'applied' && applied ? (
        <div className="space-y-3 animate-fade-up">
          <div className="flex items-center gap-2.5 rounded-xl border border-mint/25 bg-mint/[0.04] p-3.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-mint/30 bg-mint/10 text-mint">
              <IconCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-slate-100">Edit applied</p>
              <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                {applied.path} Â· {shortHash(applied.beforeHash)} â†’ {shortHash(applied.afterHash)}
              </p>
            </div>
          </div>

          <p className="text-[10px] leading-relaxed text-slate-500">
            Undo is available until{' '}
            {new Date(applied.rollbackExpiresAt).toLocaleTimeString([], { hour12: false })}. It
            lives in server memory only; a restart invalidates it.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleRollback()}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose/30 bg-rose/10 px-3 py-1.5 text-[11px] font-semibold text-rose-200 transition-colors hover:bg-rose/15"
            >
              Undo this edit
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
            >
              Start another edit
            </button>
          </div>
        </div>
      ) : null}

      {root && phase === 'rolling' ? (
        <div className="flex items-center gap-3 rounded-xl border border-line/70 bg-white/[0.015] px-3.5 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-rose/70 animate-pulse-dot" />
          <p className="text-[12px] text-slate-200">Restoring the original bytesâ€¦</p>
        </div>
      ) : null}

      {root && phase === 'rolledback' ? (
        <div className="space-y-3 animate-fade-up">
          <div className="flex items-center gap-2.5 rounded-xl border border-mint/25 bg-mint/[0.04] p-3.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-mint/30 bg-mint/10 text-mint">
              <IconCheck className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[12px] font-medium text-slate-100">Edit undone</p>
              <p className="mt-0.5 text-[10.5px] text-slate-500">
                The original bytes were restored and the SHA-256 hash verified.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
          >
            Start another edit
          </button>
        </div>
      ) : null}
    </Panel>
  );
}