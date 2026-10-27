import { useCallback, useEffect, useRef, useState } from 'react';

import { ActivityLog } from './components/ActivityLog';
import { Badge } from './components/Badge';
import { ExecutionPanel } from './components/ExecutionPanel';
import { IconAlert } from './components/icons';
import { PipelineStrip } from './components/PipelineStrip';
import { PlanPanel } from './components/PlanPanel';
import { RepositoryPanel } from './components/RepositoryPanel';
import { Sidebar } from './components/Sidebar';
import { TaskComposer } from './components/TaskComposer';
import { Topbar } from './components/Topbar';
import { VerificationPanel } from './components/VerificationPanel';
import { buildPlanReport } from './demoData';
import { useHealth } from './hooks/useHealth';
import type {
  ActivityEntry,
  ActivityKind,
  InspectionResult,
  PlanReport,
} from './types';

function createEntry(kind: ActivityKind, message: string): ActivityEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    kind,
    message,
  };
}

export default function App() {
  const health = useHealth();
  const [task, setTask] = useState('');
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [report, setReport] = useState<PlanReport | null>(null);
  const [entries, setEntries] = useState<ActivityEntry[]>(() => [
    createEntry(
      'system',
      'ANIRA scaffold loaded — execution, model calls and desktop control are disabled.',
    ),
    createEntry(
      'demo',
      'Panel content is illustrative. Entries tagged DEMO are not real events.',
    ),
  ]);

  const log = useCallback((kind: ActivityKind, message: string) => {
    setEntries((previous) => [createEntry(kind, message), ...previous].slice(0, 50));
  }, []);

  const lastHealthStatus = useRef(health.status);

  useEffect(() => {
    if (health.status === lastHealthStatus.current) {
      return;
    }

    lastHealthStatus.current = health.status;

    if (health.status === 'online') {
      log(
        'system',
        `Backend health check passed (${health.payload?.service ?? 'anira-server'} v${
          health.payload?.version ?? '0.1.0'
        }) — scaffold mode, execution disabled.`,
      );
    }

    if (health.status === 'offline') {
      log('system', 'Backend health check failed — start the API on port 4000 and retry.');
    }
  }, [health.status, health.payload, log]);

  function handleGenerate() {
    const trimmed = task.trim();
    if (!trimmed) {
      return;
    }

    setReport(buildPlanReport(trimmed, inspection));
    const shortened = trimmed.replace(/\s+/g, ' ');
    log(
      'demo',
      `Draft plan generated for “${shortened.length > 72 ? `${shortened.slice(0, 72)}…` : shortened}” ${
        inspection ? `from the ${inspection.name} scan` : 'without a repository scan'
      } — no actions were queued or executed.`,
    );
  }

  function handleClear() {
    setTask('');
    setReport(null);
    log('user', 'Cleared the task brief and draft plan.');
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar health={health} />

        <div className="border-b border-amber/20 bg-amber/[0.07]">
          <div className="mx-auto flex max-w-[1500px] items-start gap-2 px-4 py-2.5 text-[11px] leading-relaxed text-amber-200/90 sm:px-6 lg:px-8">
            <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              <span className="font-semibold uppercase tracking-[0.14em]">Guarded scaffold</span> —
              ANIRA cannot edit files, run arbitrary commands or call a model. Planned actions are
              illustrative; the Verification panel can run one allowlisted{' '}
              <span className="font-mono">npm test</span> check after approval, and that check
              executes repository code. Activity entries tagged LIVE are real UI events.
            </p>
          </div>
        </div>

        <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
          <section className="overflow-hidden rounded-2xl border border-line/80 bg-gradient-to-br from-panel-2/90 via-panel/70 to-ink/40 p-6 sm:p-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-mint animate-pulse-dot" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-mint/80">
                    Command center
                  </p>
                </div>
                <h1 className="mt-2.5 text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-slate-50 sm:text-[30px]">
                  A desktop assistant that <span className="text-mint">proves its work</span>.
                </h1>
                <p className="mt-2.5 max-w-xl text-[13.5px] leading-relaxed text-slate-400">
                  ANIRA is built around one loop: plan, approve, execute, verify, undo. This
                  milestone ships the shell, the API heartbeat and one explicitly approved project
                  check.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Badge variant="muted">Scaffold · v0.1.0</Badge>
                <Badge variant="danger">Shell off</Badge>
                <Badge variant="muted">Model calls off</Badge>
              </div>
            </div>

            <div className="mt-6 border-t border-line/50 pt-5">
              <PipelineStrip />
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-12">
            <div className="space-y-6 xl:col-span-8">
              <TaskComposer
                task={task}
                onTaskChange={setTask}
                onGenerate={handleGenerate}
                onClear={handleClear}
                hasPlan={Boolean(report)}
              />
              <PlanPanel report={report} />
              <RepositoryPanel onLog={log} onInspected={setInspection} />
            </div>

            <div className="space-y-6 xl:col-span-4">
              <ExecutionPanel plan={report?.steps ?? null} />
              <VerificationPanel root={inspection?.root ?? null} onLog={log} />
              <ActivityLog entries={entries} />
            </div>
          </div>

          <footer className="flex flex-col gap-2 border-t border-line/60 pt-6 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>
              ANIRA · scaffold milestone · one approved project check · no arbitrary commands,
              edits, model calls or desktop control
            </p>
            <p className="font-mono">PLAN → APPROVE → EXECUTE → VERIFY → UNDO</p>
          </footer>
        </main>
      </div>
    </div>
  );
}