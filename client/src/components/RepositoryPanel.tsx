import { useState } from 'react';

import { formatBytes } from '../demoData';
import { evidenceHeaders } from '../evidenceSession';
import type { ActivityKind, InspectionResult } from '../types';
import { Badge } from './Badge';
import { IconFile } from './icons';
import { Panel } from './Panel';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_path: 'Enter an absolute path to a local folder.',
  not_found: 'That folder was not found.',
  not_a_directory: 'That path is a file, not a folder.',
  access_denied: 'Windows denied access to that folder.',
  internal_error: 'Inspection failed on the server.',
};

const MAX_VISIBLE_FILES = 100;

interface RepositoryPanelProps {
  onLog: (kind: ActivityKind, message: string) => void;
  onInspected: (result: InspectionResult | null) => void;
}

export function RepositoryPanel({ onLog, onInspected }: RepositoryPanelProps) {
  const [folder, setFolder] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InspectionResult | null>(null);

  async function handleInspect() {
    const requested = folder.trim();
    if (!requested || loading) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/inspect', {
        method: 'POST',
        headers: evidenceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: requested }),
      });

      const payload = (await response.json().catch(() => null)) as
        | InspectionResult
        | { error?: string }
        | null;

      if (!response.ok) {
        const code =
          payload && typeof payload === 'object' && 'error' in payload && payload.error
            ? payload.error
            : 'internal_error';
        setResult(null);
        setError(ERROR_MESSAGES[code] ?? 'Inspection failed.');
        onInspected(null);
        onLog('system', `Repository inspection failed (${code}).`);
        return;
      }

      const inspection = payload as InspectionResult;
      setResult(inspection);
      onInspected(inspection);
      onLog(
        'system',
        `Inspected ${inspection.name} — ${inspection.totalFiles} files, ${inspection.stack.length} stack signals. Read-only.`,
      );
    } catch {
      setResult(null);
      setError('Could not reach the inspection API.');
      onInspected(null);
      onLog('system', 'Repository inspection failed (network).');
    } finally {
      setLoading(false);
    }
  }

  const visibleFiles = result?.files.slice(0, MAX_VISIBLE_FILES) ?? [];

  return (
    <Panel
      title="Repository inspection"
      subtitle="Read-only inventory of a local project folder."
      badge={<Badge variant="ok">Live scan</Badge>}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleInspect();
        }}
      >
        <label htmlFor="repository-path" className="sr-only">
          Local project folder
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="repository-path"
            type="text"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder="C:\dev\my-project"
            spellCheck={false}
            autoComplete="off"
            aria-describedby="repository-path-note"
            className="min-w-0 flex-1 rounded-lg border border-line/80 bg-ink/60 px-3 py-2 font-mono text-[11.5px] text-slate-200 placeholder:text-slate-600 transition-colors focus:outline-none focus-visible:border-mint/40"
          />
          <button
            type="submit"
            disabled={loading || folder.trim().length === 0}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-mint/30 bg-mint/15 px-3 py-2 text-[11px] font-semibold text-mint transition-colors hover:bg-mint/20 disabled:cursor-not-allowed disabled:border-line disabled:bg-white/[0.02] disabled:text-slate-600"
          >
            {loading ? 'Scanning…' : 'Inspect folder'}
          </button>
        </div>
        <p id="repository-path-note" className="mt-2 text-[10.5px] leading-relaxed text-slate-500">
          Absolute path. Skips node_modules, .git, dist and build. Only names and sizes are read —
          files are never modified or executed.
        </p>
      </form>

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-rose/25 bg-rose/[0.06] px-3 py-2 text-[11px] leading-relaxed text-rose-200"
        >
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-3.5 animate-fade-up">
          <div className="rounded-xl border border-line/70 bg-white/[0.015] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-slate-100">{result.name}</p>
                <p
                  className="mt-0.5 truncate font-mono text-[10px] text-slate-500"
                  title={result.root}
                >
                  {result.root}
                </p>
              </div>
              <Badge variant="ok">Read only</Badge>
            </div>

            <dl className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-line/60 bg-ink/40 px-2.5 py-2">
                <dt className="text-[9px] uppercase tracking-[0.12em] text-slate-500">Files</dt>
                <dd className="tnum mt-0.5 font-mono text-[13px] text-slate-200">
                  {result.totalFiles}
                  {result.truncated ? '+' : ''}
                </dd>
              </div>
              <div className="rounded-lg border border-line/60 bg-ink/40 px-2.5 py-2">
                <dt className="text-[9px] uppercase tracking-[0.12em] text-slate-500">Size</dt>
                <dd className="tnum mt-0.5 font-mono text-[13px] text-slate-200">
                  {formatBytes(result.totalBytes)}
                </dd>
              </div>
              <div className="rounded-lg border border-line/60 bg-ink/40 px-2.5 py-2">
                <dt className="text-[9px] uppercase tracking-[0.12em] text-slate-500">Stack</dt>
                <dd className="tnum mt-0.5 font-mono text-[13px] text-slate-200">
                  {result.stack.length}
                </dd>
              </div>
            </dl>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Detected stack
            </p>
            {result.stack.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {result.stack.map((signal) => (
                  <span
                    key={signal.name}
                    title={signal.reason}
                    className="rounded-md border border-line bg-white/[0.02] px-2 py-1 text-[10.5px] text-slate-300"
                  >
                    {signal.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">No recognized stack signals.</p>
            )}
          </div>

          {result.languages.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {result.languages.map((language) => (
                <span key={language.name} className="text-[10.5px] text-slate-400">
                  {language.name}
                  <span className="tnum ml-1 font-mono text-[9.5px] text-slate-500">
                    {language.files}
                  </span>
                </span>
              ))}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-line/70">
            <div className="flex items-center justify-between border-b border-line/60 bg-white/[0.015] px-3 py-2">
              <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Files
              </span>
              <span className="tnum font-mono text-[10px] text-slate-500">
                {result.files.length}
                {result.truncated ? '+' : ''}
              </span>
            </div>
            <ul className="max-h-[220px] divide-y divide-line/40 overflow-y-auto">
              {visibleFiles.map((file) => (
                <li key={file.path} className="flex items-center gap-2 px-3 py-1.5">
                  <span
                    className="truncate font-mono text-[10.5px] text-slate-300"
                    title={file.path}
                  >
                    {file.path}
                  </span>
                  <span className="tnum ml-auto shrink-0 font-mono text-[9.5px] text-slate-500">
                    {formatBytes(file.sizeBytes)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {result.files.length > MAX_VISIBLE_FILES ? (
            <p className="text-[10px] text-slate-500">
              Showing the first {MAX_VISIBLE_FILES} of {result.files.length} files.
            </p>
          ) : null}

          {result.truncated ? (
            <p className="rounded-lg border border-amber/20 bg-amber/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-amber-200">
              Scan limit reached. Counts and stack detection cover only the files listed.
            </p>
          ) : null}

          <p className="flex items-start gap-2 border-t border-line/60 pt-3 text-[10px] leading-relaxed text-slate-500">
            <IconFile className="mt-0.5 h-3 w-3 shrink-0 text-slate-600" />
            Ignored: {result.ignored.length > 0 ? result.ignored.join(', ') : 'none found'} · scanned{' '}
            {new Date(result.scannedAt).toLocaleTimeString([], { hour12: false })}
          </p>
        </div>
      ) : null}
    </Panel>
  );
}