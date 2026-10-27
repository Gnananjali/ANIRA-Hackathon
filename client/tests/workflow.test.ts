import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CheckRunResult } from '../src/types';
import {
  deriveWorkflowState,
  type WorkflowInput,
  type WorkflowStage,
} from '../src/workflow';

const base: WorkflowInput = {
  inspected: false,
  hasPlan: false,
  checkPhase: 'idle',
  checkResult: null,
};

function checkResult(overrides: Partial<CheckRunResult> = {}): CheckRunResult {
  return {
    checkId: 'node-test',
    command: 'npm test',
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 3120,
    stdout: '',
    stderr: '',
    truncated: false,
    ...overrides,
  };
}

function stageMap(input: WorkflowInput): Record<string, WorkflowStage> {
  return Object.fromEntries(
    deriveWorkflowState(input).map((stage) => [stage.id, stage]),
  );
}

describe('workflow derivation', () => {
  it('returns the six stages in workflow order', () => {
    const stages = deriveWorkflowState(base);

    assert.deepEqual(
      stages.map((stage) => stage.id),
      ['inspect', 'plan', 'approve', 'execute', 'verify', 'recover'],
    );
  });

  it('starts with nothing scanned, planned, or run', () => {
    const stages = stageMap(base);

    assert.equal(stages.inspect.state, 'Not scanned');
    assert.equal(stages.plan.state, 'No plan');
    assert.equal(stages.approve.state, 'Check only');
    assert.equal(stages.execute.state, 'Check only');
    assert.equal(stages.verify.state, 'Not run');
    assert.equal(stages.recover.state, 'No changes to undo');
  });

  it('reflects a completed scan and draft plan', () => {
    const stages = stageMap({ ...base, inspected: true, hasPlan: true });

    assert.equal(stages.inspect.state, 'Folder scanned');
    assert.equal(stages.inspect.tone, 'mint');
    assert.equal(stages.plan.state, 'Draft ready');
    assert.equal(stages.plan.tone, 'mint');
  });

  it('shows a check being prepared', () => {
    const stages = stageMap({ ...base, checkPhase: 'preparing' });

    assert.equal(stages.approve.state, 'Preparing check');
    assert.equal(stages.approve.tone, 'sky');
    assert.equal(stages.execute.state, 'Check only');
    assert.equal(stages.verify.state, 'Not run');
  });

  it('shows an armed approval without claiming a run', () => {
    const stages = stageMap({ ...base, checkPhase: 'prepared' });

    assert.equal(stages.approve.state, 'Check armed');
    assert.equal(stages.approve.tone, 'sky');
    assert.equal(stages.execute.state, 'Check only');
    assert.equal(stages.verify.state, 'Not run');
  });

  it('shows a running check', () => {
    const stages = stageMap({ ...base, checkPhase: 'running' });

    assert.equal(stages.approve.state, 'Check approved');
    assert.equal(stages.execute.state, 'Check running');
    assert.equal(stages.verify.state, 'Awaiting result');
    assert.equal(stages.verify.tone, 'sky');
  });

  it('shows a real exit 0 with duration', () => {
    const stages = stageMap({
      ...base,
      checkPhase: 'done',
      checkResult: checkResult({ exitCode: 0, durationMs: 3120 }),
    });

    assert.equal(stages.verify.state, 'Exit 0 · 3.1 s');
    assert.equal(stages.verify.tone, 'mint');
    assert.equal(stages.recover.state, 'No changes to undo');
    assert.equal(stages.recover.tone, 'muted');
  });

  it('shows a real non-zero exit without calling it a pass', () => {
    const stages = stageMap({
      ...base,
      checkPhase: 'done',
      checkResult: checkResult({ exitCode: 3, durationMs: 1000 }),
    });

    assert.equal(stages.verify.state, 'Exit 3 · 1.0 s');
    assert.equal(stages.verify.tone, 'rose');
    assert.equal(stages.recover.state, 'Retry with new approval');
    assert.equal(stages.recover.tone, 'sky');
  });

  it('marks a timeout as interrupted', () => {
    const stages = stageMap({
      ...base,
      checkPhase: 'done',
      checkResult: checkResult({ exitCode: null, timedOut: true, durationMs: 12_000 }),
    });

    assert.equal(stages.verify.state, 'Timed out · 12.0 s');
    assert.equal(stages.verify.tone, 'rose');
    assert.equal(stages.recover.state, 'Retry with new approval');
  });

  it('points at the message after an error', () => {
    const stages = stageMap({ ...base, checkPhase: 'error' });

    assert.equal(stages.recover.state, 'Retry — see message');
    assert.equal(stages.recover.tone, 'sky');
  });

  it('never reports Verify as passed without a result', () => {
    for (const phase of ['idle', 'prepared', 'error'] as const) {
      const stages = stageMap({ ...base, checkPhase: phase });
      assert.equal(stages.verify.state, 'Not run');
      assert.equal(stages.verify.tone, 'muted');
    }
  });
});