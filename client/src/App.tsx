import { useCallback, useEffect, useRef, useState } from 'react';

import { ActivityLog } from './components/ActivityLog';
import { Badge } from './components/Badge';
import { ControlledEditPanel } from './components/ControlledEditPanel';
import { EvidencePanel } from './components/EvidencePanel';
import { ExecutionPanel } from './components/ExecutionPanel';
import { IconAlert } from './components/icons';
import { PipelineStrip } from './components/PipelineStrip';
import { PlanPanel } from './components/PlanPanel';
import { PlannerConsent } from './components/PlannerConsent';
import { RepositoryPanel } from './components/RepositoryPanel';
import { Sidebar } from './components/Sidebar';
import { TaskComposer } from './components/TaskComposer';
import { Topbar } from './components/Topbar';
import { VerificationPanel } from './components/VerificationPanel';
import { consentRequired, grantExternalConsent } from './consent';
import { buildPlanReport } from './demoData';
import { useHealth } from './hooks/useHealth';
import { buildAiReport, buildFallbackReport, fallbackLabel } from './planMapping';
import {
  createSingleFlight,
  fetchPlannerConfig,
  requestPlan,
  type PlannerConfig,
} from './plannerClient';
import { deriveWorkflowState, type WorkflowPhase } from './workflow';
import type {
  ActivityEntry,
  ActivityKind,
  CheckRunResult,
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
  const [checkPhase, setCheckPhase] = useState<WorkflowPhase>('idle');
  const [checkResult, setCheckResult] = useState<CheckRunResult | null>(null);
  const [plannerConfig, setPlannerConfig] = useState<PlannerConfig | null>(null);
  const [plannerConfigLoaded, setPlannerConfigLoaded] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const singleFlight = useRef(createSingleFlight()).current;
  const [evidenceVersion, setEvidenceVersion] = useState(0);
  const [entries, setEntries] = useState<ActivityEntry[]>(() => [
    createEntry(
      'system',
      'ANIRA loaded — guarded check and edit flows are available, and plans are proposals only.',
    ),
  ]);

  const log = useCallback((kind: ActivityKind, message: string) => {
    setEntries((previous) => [createEntry(kind, message), ...previous].slice(0, 50));
    setEvidenceVersion((value) => value + 1);
  }, []);

  const handleCheckState = useCallback(
    (state: { phase: WorkflowPhase; result: CheckRunResult | null }) => {
      setCheckPhase(state.phase);
      setCheckResult(state.result);
    },
    [],
  );

  const stages = deriveWorkflowState({
    inspected: Boolean(inspection),
    hasPlan: Boolean(report),
    checkPhase,
    checkResult,
  });

  const plannerMode: 'ai' | 'local' = plannerConfig?.available ? 'ai' : 'local';
  const plannerHint = !plannerConfigLoaded
    ? 'Checking planner availability…'
    : plannerConfig?.available
      ? plannerConfig.provider === 'local'
        ? 'Local AI model · repository metadata stays on this machine · deterministic fallback.'
        : 'External AI provider · first use asks for consent · deterministic fallback.'
      : plannerConfig
        ? 'No AI provider configured · deterministic planner in use.'
        : 'Planner status unavailable · deterministic planner in use.';

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
        }) — one allowlisted check available.`,
      );
    }

    if (health.status === 'offline') {
      log('system', 'Backend health check failed — start the API on port 4000 and retry.');
    }
  }, [health.status, health.payload, log]);

  useEffect(() => {
    let cancelled = false;

    void fetchPlannerConfig().then((config) => {
      if (!cancelled) {
        setPlannerConfig(config);
        setPlannerConfigLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function sessionStorageOrNull(): Storage | null {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }

  function logPlanReport(next: PlanReport) {
    log(
      'user',
      next.planner === 'ai'
        ? `AI plan generated with ${next.plannerModel ?? 'the configured model'} — proposals only.`
        : `Local plan generated (${fallbackLabel(next.plannerReason)}).`,
    );
  }

  function useLocalPlan(brief: string, reason: string) {
    const next = buildFallbackReport(buildPlanReport(brief, inspection), reason);
    setReport(next);
    logPlanReport(next);
  }

  async function runPlan(brief: string) {
    if (!inspection) {
      useLocalPlan(brief, 'no_inspection');
      return;
    }

    const root = inspection.root;
    const base = buildPlanReport(brief, inspection);

    try {
      const outcome = await singleFlight(async () => {
        setPlanning(true);

        try {
          return await requestPlan({ root, brief });
        } finally {
          setPlanning(false);
        }
      });

      if (outcome === null) {
        return;
      }

      if (!outcome.ok) {
        const next = buildFallbackReport(base, outcome.reason);
        setReport(next);
        logPlanReport(next);
        return;
      }

      if (outcome.response.planner === 'ai') {
        const next = buildAiReport(base, outcome.response, plannerConfig?.provider);
        setReport(next);
        logPlanReport(next);
        return;
      }

      const next = buildFallbackReport(base, outcome.response.reason);
      setReport(next);
      logPlanReport(next);
    } catch {
      const next = buildFallbackReport(base, 'request_failed');
      setReport(next);
      logPlanReport(next);
    }
  }

  function handleGenerate() {
    const brief = task.trim();

    if (!brief || planning) {
      return;
    }

    if (!inspection) {
      useLocalPlan(brief, 'no_inspection');
      return;
    }

    if (!plannerConfigLoaded || !plannerConfig) {
      useLocalPlan(brief, 'planner_unavailable');
      return;
    }

    if (!plannerConfig.available) {
      // Ask the local server for the fallback so the planning event is
      // recorded. It returns no_api_key without contacting any provider.
      void runPlan(brief);
      return;
    }

    if (consentRequired(plannerConfig.provider, sessionStorageOrNull())) {
      setPendingPlan(brief);
      return;
    }

    void runPlan(brief);
  }

  function handleConsentAllow() {
    if (!pendingPlan) {
      return;
    }

    grantExternalConsent(sessionStorageOrNull());
    const brief = pendingPlan;
    setPendingPlan(null);
    void runPlan(brief);
  }

  function handleConsentLocal() {
    if (!pendingPlan) {
      return;
    }

    const brief = pendingPlan;
    setPendingPlan(null);
    useLocalPlan(brief, 'user_declined_external');
  }

  function handleClear() {
    setTask('');
    setReport(null);
    setPendingPlan(null);
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
              ANIRA cannot run arbitrary commands or control your desktop. AI planning may
              call the configured model; external providers require consent, and proposed
              steps never execute. The Verification panel can run one allowlisted{' '}
              <span className="font-mono">npm test</span> check after approval; Controlled edit can
              rewrite one existing text file after a server-generated diff. Both act on your
              machine, only after approval. Activity entries are real UI events.
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
                  milestone ships AI planning with a local fallback, the guarded API heartbeat,
                  one explicitly approved project check, and one previewed file-edit lane.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Badge variant="muted">Scaffold · v0.1.0</Badge>
                <Badge variant="danger">Shell off</Badge>
                <Badge variant="muted">Planning only</Badge>
              </div>
            </div>

            <div className="mt-6 border-t border-line/50 pt-5">
              <PipelineStrip stages={stages} />
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                Approve, Execute and Verify above track the project check. Controlled edits use a
                separate approval loop below.
              </p>
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
                planning={planning}
                plannerMode={plannerMode}
                plannerHint={plannerHint}
              />
              <PlanPanel
                report={report}
                checkResult={checkResult}
                planning={planning}
              />
              <RepositoryPanel onLog={log} onInspected={setInspection} />
              <ControlledEditPanel root={inspection?.root ?? null} onLog={log} />
            </div>

            <div className="space-y-6 xl:col-span-4">
              <ExecutionPanel plan={report?.steps ?? null} />
              <VerificationPanel
                root={inspection?.root ?? null}
                onLog={log}
                onCheckState={handleCheckState}
              />
              <ActivityLog entries={entries} />
              <EvidencePanel refreshKey={evidenceVersion} />
            </div>
          </div>

          <footer className="flex flex-col gap-2 border-t border-line/60 pt-6 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>
              ANIRA · scaffold milestone · one approved check and one approved edit · no
              arbitrary commands or desktop control; external providers require consent before planning
            </p>
            <p className="font-mono">PLAN → APPROVE → EXECUTE → VERIFY → UNDO</p>
          </footer>
        </main>
      </div>

      {pendingPlan ? (
        <PlannerConsent
          model={plannerConfig?.model}
          onAllow={handleConsentAllow}
          onUseLocal={handleConsentLocal}
          onCancel={() => setPendingPlan(null)}
        />
      ) : null}
    </div>
  );
}