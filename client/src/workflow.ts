import { exitLabel, formatDuration } from './checkFormat';
import type { CheckRunResult } from './types';

export type WorkflowPhase =
  | 'idle'
  | 'preparing'
  | 'prepared'
  | 'running'
  | 'done'
  | 'error';

export type StageTone = 'mint' | 'sky' | 'muted' | 'rose';

export interface WorkflowStage {
  id: 'inspect' | 'plan' | 'approve' | 'execute' | 'verify' | 'recover';
  label: string;
  state: string;
  tone: StageTone;
}

export interface WorkflowInput {
  inspected: boolean;
  hasPlan: boolean;
  checkPhase: WorkflowPhase;
  checkResult: CheckRunResult | null;
}

/**
 * Derives the six-stage strip from real state.
 *
 * Only the project check reaches Approve/Execute/Verify. Plan steps remain
 * drafts, and Undo is not applicable because ANIRA never changes files.
 */
export function deriveWorkflowState(input: WorkflowInput): WorkflowStage[] {
  const { inspected, hasPlan, checkPhase, checkResult } = input;

  const approveTone: StageTone =
    checkPhase === 'preparing' ||
    checkPhase === 'prepared' ||
    checkPhase === 'running' ||
    checkPhase === 'done'
      ? 'sky'
      : 'muted';
  const approveState =
    checkPhase === 'preparing'
      ? 'Preparing check'
      : checkPhase === 'prepared'
        ? 'Check armed'
        : checkPhase === 'running' || checkPhase === 'done'
          ? 'Check approved'
          : 'Check only';

  const executeTone: StageTone =
    checkPhase === 'running' || checkPhase === 'done' ? 'sky' : 'muted';
  const executeState =
    checkPhase === 'running'
      ? 'Check running'
      : checkPhase === 'done'
        ? 'Check finished'
        : 'Check only';

  let verifyState = 'Not run';
  let verifyTone: StageTone = 'muted';

  if (checkPhase === 'running') {
    verifyState = 'Awaiting result';
    verifyTone = 'sky';
  } else if (checkResult) {
    const passed = !checkResult.timedOut && checkResult.exitCode === 0;
    verifyState = `${exitLabel(checkResult.exitCode, checkResult.timedOut)} · ${formatDuration(
      checkResult.durationMs,
    )}`;
    verifyTone = passed ? 'mint' : 'rose';
  }

  const failed = Boolean(
    checkResult && (checkResult.timedOut || checkResult.exitCode !== 0),
  );
  const recoverState =
    checkPhase === 'error'
      ? 'Retry — see message'
      : failed
        ? 'Retry with new approval'
        : 'No changes to undo';
  const recoverTone: StageTone =
    checkPhase === 'error' || failed ? 'sky' : 'muted';

  return [
    {
      id: 'inspect',
      label: 'Inspect',
      state: inspected ? 'Folder scanned' : 'Not scanned',
      tone: inspected ? 'mint' : 'muted',
    },
    {
      id: 'plan',
      label: 'Plan',
      state: hasPlan ? 'Draft ready' : 'No plan',
      tone: hasPlan ? 'mint' : 'muted',
    },
    { id: 'approve', label: 'Approve', state: approveState, tone: approveTone },
    { id: 'execute', label: 'Execute', state: executeState, tone: executeTone },
    { id: 'verify', label: 'Verify', state: verifyState, tone: verifyTone },
    { id: 'recover', label: 'Recover/Undo', state: recoverState, tone: recoverTone },
  ];
}