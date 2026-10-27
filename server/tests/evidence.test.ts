import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { after, describe, it } from 'node:test';

import { createApp, type AppOptions } from '../src/app';
import { createCheckService } from '../src/checks/service';
import { createEvidenceStore, type EvidenceStoreOptions } from '../src/evidence/store';
import {
  EvidenceError,
  type EvidenceEvent,
  type EvidenceInput,
} from '../src/evidence/schema';
import { createPlannerService } from '../src/planner/service';

const SESSION_A = 'session-a-0001';
const SESSION_B = 'session-b-0002';
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

const scratch: string[] = [];

interface TimelineResponse {
  sessionId: string;
  events: EvidenceEvent[];
  limits: {
    maxEventsPerSession: number;
    maxSessions: number;
    maxOutputBytes: number;
  };
  persistence: string;
  note: string;
}

async function startApp(options?: AppOptions) {
  const server: Server = createApp(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function withApp(
  options: AppOptions,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = await startApp(options);

  try {
    await run(app.baseUrl);
  } finally {
    await app.close();
  }
}

async function makeProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anira-evidence-'));
  scratch.push(root);

  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'evidence-fixture',
      private: true,
      scripts: { test: 'node test.js' },
    }),
  );
  await fs.writeFile(path.join(root, 'README.md'), '# Evidence fixture\n');
  await fs.writeFile(path.join(root, 'test.js'), 'console.log("fixture");\n');

  return root;
}

function headers(
  session = SESSION_A,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-ANIRA-Session': session,
    ...extra,
  };
}

async function post(
  baseUrl: string,
  route: string,
  body: unknown,
  requestHeaders: Record<string, string>,
) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: response.status, body: json as Record<string, any> };
}

async function timeline(
  baseUrl: string,
  session = SESSION_A,
): Promise<TimelineResponse> {
  const response = await fetch(`${baseUrl}/api/evidence`, {
    headers: { 'X-ANIRA-Session': session },
  });
  assert.equal(response.status, 200);
  return (await response.json()) as TimelineResponse;
}

function inspectionInput(): EvidenceInput {
  return {
    type: 'inspection',
    outcome: 'executed',
    operation: 'inspection.scan',
    evidence: {
      kind: 'inspection',
      repoName: 'fixture',
      totalFiles: 3,
      truncated: false,
      ignoredFolders: ['node_modules'],
      stack: ['Node.js'],
      languages: [{ name: 'TypeScript', files: 2 }],
    },
  };
}

function planningInput(): EvidenceInput {
  return {
    type: 'planning',
    outcome: 'planned',
    operation: 'planner.plan',
    evidence: {
      kind: 'planning',
      planner: 'ai',
      model: 'test-model',
      stepCount: 1,
      steps: [{ id: 'step-1', action: 'read', risk: 'low' }],
      inspected: { totalFiles: 3, truncated: false },
    },
  };
}

function approvalInput(
  outcome: 'planned' | 'approved' = 'planned',
): EvidenceInput {
  return {
    type: 'approval',
    outcome,
    operation: outcome === 'planned' ? 'checks.prepare' : 'checks.run',
    evidence: {
      kind: 'approval',
      target: 'check',
      checkId: 'node-test',
      command: 'npm test',
    },
  };
}

function editInput(
  outcome: 'planned' | 'executed' | 'failed' | 'blocked' = 'planned',
  reason?: string,
): EvidenceInput {
  return {
    type: 'edit',
    outcome,
    operation: 'edits.apply',
    ...(reason ? { reason } : {}),
    evidence: {
      kind: 'edit',
      path: 'README.md',
      beforeHash: HASH_A,
      afterHash: HASH_B,
    },
  };
}

function verificationInput(
  outcome: 'verified' | 'failed',
  exitCode: number | null,
  timedOut: boolean,
  stdout = 'stdout',
  stderr = 'stderr',
): EvidenceInput {
  return {
    type: 'verification',
    outcome,
    operation: 'checks.run',
    ...(outcome === 'failed'
      ? { reason: timedOut ? 'timed_out' : 'nonzero_exit' }
      : {}),
    evidence: {
      kind: 'verification',
      checkId: 'node-test',
      command: 'npm test',
      exitCode,
      timedOut,
      durationMs: 12,
      truncated: false,
      stdout,
      stderr,
      coversPlanSteps: false,
    },
  };
}

function recoveryInput(
  outcome: 'recovered' | 'failed' | 'blocked' = 'recovered',
  reason?: string,
): EvidenceInput {
  return {
    type: 'recovery',
    outcome,
    operation: 'edits.rollback',
    ...(reason ? { reason } : {}),
    evidence: {
      kind: 'recovery',
      path: 'README.md',
      ...(outcome === 'recovered'
        ? { restoredHash: HASH_A, verifiedHash: true }
        : { verifiedHash: false }),
      afterHash: HASH_B,
    },
  };
}

function failureInput(): EvidenceInput {
  return {
    type: 'failure',
    outcome: 'blocked',
    operation: 'checks.run',
    reason: 'approval_invalid',
    evidence: {
      kind: 'failure',
      operation: 'checks.run',
      reason: 'approval_invalid',
    },
  };
}

function makeStore(options: EvidenceStoreOptions = {}) {
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  let sequence = 0;

  return createEvidenceStore({
    now: () => {
      clock += 1;
      return clock;
    },
    id: () => `evt-${++sequence}`,
    ...options,
  });
}

function isEvidenceError(code: string) {
  return (error: unknown) =>
    error instanceof EvidenceError && error.code === code;
}

after(async () => {
  await Promise.all(
    scratch.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('evidence store', () => {
  it('creates typed events with server-generated identity', () => {
    const store = makeStore();

    store.append(SESSION_A, inspectionInput());
    store.append(SESSION_A, planningInput());
    store.append(SESSION_A, approvalInput('planned'));
    store.append(SESSION_A, approvalInput('approved'));
    store.append(SESSION_A, editInput('planned'));
    store.append(SESSION_A, editInput('executed'));
    store.append(SESSION_A, verificationInput('verified', 0, false));
    store.append(SESSION_A, recoveryInput('recovered'));

    const events = store.list(SESSION_A);

    assert.equal(events.length, 8);
    assert.deepEqual(
      events.map((event) => event.type),
      [
        'inspection',
        'planning',
        'approval',
        'approval',
        'edit',
        'edit',
        'verification',
        'recovery',
      ],
    );
    assert.deepEqual(
      events.map((event) => event.outcome),
      [
        'executed',
        'planned',
        'planned',
        'approved',
        'planned',
        'executed',
        'verified',
        'recovered',
      ],
    );
    assert.equal(new Set(events.map((event) => event.id)).size, events.length);
    assert.equal(events.every((event) => event.sessionId === SESSION_A), true);

    for (const event of events) {
      assert.match(event.id, /^evt-\d+$/);
      assert.equal(Number.isNaN(Date.parse(event.at)), false);
    }
  });

  it('rejects missing evidence and impossible success claims', () => {
    const store = makeStore();

    const missingAfterHash = editInput('executed') as any;
    delete missingAfterHash.evidence.afterHash;
    assert.throws(
      () => store.append(SESSION_A, missingAfterHash),
      isEvidenceError('missing_evidence'),
    );

    const missingTotal = inspectionInput() as any;
    delete missingTotal.evidence.totalFiles;
    assert.throws(
      () => store.append(SESSION_A, missingTotal),
      isEvidenceError('missing_evidence'),
    );

    const missingPlanner = planningInput() as any;
    delete missingPlanner.evidence.planner;
    assert.throws(
      () => store.append(SESSION_A, missingPlanner),
      isEvidenceError('missing_evidence'),
    );

    const missingCheck = approvalInput('approved') as any;
    delete missingCheck.evidence.checkId;
    assert.throws(
      () => store.append(SESSION_A, missingCheck),
      isEvidenceError('missing_evidence'),
    );

    const missingRestore = recoveryInput('recovered') as any;
    delete missingRestore.evidence.restoredHash;
    assert.throws(
      () => store.append(SESSION_A, missingRestore),
      isEvidenceError('missing_evidence'),
    );

    const missingHashVerification = recoveryInput('recovered') as any;
    delete missingHashVerification.evidence.verifiedHash;
    assert.throws(
      () => store.append(SESSION_A, missingHashVerification),
      isEvidenceError('missing_evidence'),
    );

    const falseRecoveryVerification = recoveryInput('failed', 'write_failed') as any;
    falseRecoveryVerification.evidence.verifiedHash = true;
    assert.throws(
      () => store.append(SESSION_A, falseRecoveryVerification),
      isEvidenceError('invalid_outcome'),
    );

    const missingReason = failureInput() as any;
    delete missingReason.reason;
    assert.throws(
      () => store.append(SESSION_A, missingReason),
      isEvidenceError('missing_evidence'),
    );

    const falseVerified = verificationInput('verified', 3, false) as any;
    assert.throws(
      () => store.append(SESSION_A, falseVerified),
      isEvidenceError('invalid_outcome'),
    );

    const falseFailure = verificationInput('failed', 0, false) as any;
    assert.throws(
      () => store.append(SESSION_A, falseFailure),
      isEvidenceError('invalid_outcome'),
    );

    assert.deepEqual(store.list(SESSION_A), []);
  });

  it('keeps failed outcomes truthful and never verifies plan steps', () => {
    const store = makeStore();

    store.append(SESSION_A, planningInput());
    store.append(SESSION_A, verificationInput('failed', 3, false));
    store.append(SESSION_A, verificationInput('failed', null, true));
    store.append(SESSION_A, editInput('blocked', 'file_changed'));
    store.append(SESSION_A, recoveryInput('failed', 'write_failed'));
    store.append(SESSION_A, failureInput());

    const events = store.list(SESSION_A);
    const checks = events.filter((event) => event.type === 'verification');

    assert.equal(checks.length, 2);
    assert.equal(checks.every((event) => event.outcome === 'failed'), true);
    assert.equal(
      events.some(
        (event) =>
          event.type === 'verification' && event.evidence.coversPlanSteps !== false,
      ),
      false,
    );
    assert.equal(
      events.some(
        (event) => event.outcome === 'verified' && event.type !== 'verification',
      ),
      false,
    );
    assert.deepEqual(
      events.find((event) => event.type === 'edit')?.evidence,
      editInput('blocked', 'file_changed').evidence,
    );
  });

  it('sanitizes and caps recorded command output', () => {
    const store = makeStore({
      maxOutputBytes: 64,
      secrets: ['should-not-leak'],
    });

    store.append(
      SESSION_A,
      verificationInput(
        'verified',
        0,
        false,
        'should-not-leak \u001b[31mred\u001b[0m ' + 'x'.repeat(500),
        'Bearer abcdefghijklmnop ' + 'y'.repeat(500),
      ),
    );

    const event = store.list(SESSION_A)[0];
    assert.equal(event.type, 'verification');
    if (event.type !== 'verification') {
      return;
    }

    assert.equal(event.evidence.truncated, true);
    assert.ok(Buffer.byteLength(event.evidence.stdout, 'utf8') <= 64);
    assert.ok(Buffer.byteLength(event.evidence.stderr, 'utf8') <= 64);
    assert.doesNotMatch(event.evidence.stdout, /should-not-leak|\u001b/);
    assert.match(event.evidence.stdout, /\[redacted\]/);
    assert.doesNotMatch(event.evidence.stderr, /abcdefghijklmnop/);
  });

  it('isolates sessions and returns read-only copies', () => {
    const store = makeStore();

    store.append(SESSION_A, inspectionInput());
    store.append(SESSION_B, planningInput());

    assert.equal(store.list(SESSION_A).length, 1);
    assert.equal(store.list(SESSION_B).length, 1);
    assert.equal(store.list(SESSION_A)[0].type, 'inspection');
    assert.equal(store.list(SESSION_B)[0].type, 'planning');

    const copy = store.list(SESSION_A);
    copy[0].operation = 'tampered';
    assert.equal(store.list(SESSION_A)[0].operation, 'inspection.scan');

    assert.deepEqual(store.list('short'), []);
    assert.throws(
      () => store.append('short', inspectionInput()),
      isEvidenceError('invalid_session'),
    );
  });

  it('bounds events per session and evicts the oldest session', () => {
    const store = makeStore({ maxEventsPerSession: 2, maxSessions: 2 });

    store.append(SESSION_A, { ...inspectionInput(), operation: 'a1' });
    store.append(SESSION_A, { ...inspectionInput(), operation: 'a2' });
    store.append(SESSION_A, { ...inspectionInput(), operation: 'a3' });

    const a = store.list(SESSION_A);
    assert.deepEqual(a.map((event) => event.operation), ['a2', 'a3']);

    store.append(SESSION_B, { ...inspectionInput(), operation: 'b1' });
    store.append('session-c-0003', { ...inspectionInput(), operation: 'c1' });

    assert.deepEqual(store.list(SESSION_A), []);
    assert.equal(store.list(SESSION_B)[0].operation, 'b1');
    assert.equal(store.list('session-c-0003')[0].operation, 'c1');
  });
});

describe('evidence API', () => {
  it('records a real inspection under one session and stays read-only', async () => {
    const root = await makeProject();
    const store = createEvidenceStore();

    await withApp({ evidence: store }, async (baseUrl) => {
      const inspected = await post(
        baseUrl,
        '/api/inspect',
        { path: root },
        headers(SESSION_A),
      );
      assert.equal(inspected.status, 200);

      const a = await timeline(baseUrl, SESSION_A);
      assert.equal(a.events.length, 1);
      const event = a.events[0];
      assert.equal(event.type, 'inspection');
      assert.equal(event.outcome, 'executed');

      if (event.type === 'inspection') {
        assert.equal(event.evidence.totalFiles, 3);
        assert.equal(event.evidence.repoName, path.basename(root));
        assert.ok(event.evidence.stack.includes('Node.js'));
      }

      const serialized = JSON.stringify(a.events);
      assert.equal(serialized.includes(root), false);
      assert.equal(serialized.includes('# Evidence fixture'), false);

      assert.deepEqual((await timeline(baseUrl, SESSION_B)).events, []);

      const fabricated = await post(
        baseUrl,
        '/api/evidence',
        verificationInput('verified', 0, false),
        headers(SESSION_A),
      );
      assert.equal(fabricated.status, 405);
      assert.equal(fabricated.body.error, 'evidence_is_read_only');
      assert.equal((await timeline(baseUrl, SESSION_A)).events.length, 1);
    });
  });

  it('records a deterministic plan as planned, not executed or verified', async () => {
    const root = await makeProject();
    const store = createEvidenceStore();

    await withApp(
      {
        evidence: store,
        plannerService: createPlannerService({ client: null }),
      },
      async (baseUrl) => {
        const planned = await post(
          baseUrl,
          '/api/plan',
          { root, brief: 'Review the README.' },
          headers(SESSION_A),
        );
        assert.equal(planned.status, 200);
        assert.equal(planned.body.planner, 'deterministic');

        const events = (await timeline(baseUrl, SESSION_A)).events;
        assert.equal(events.length, 1);
        const event = events[0];
        assert.equal(event.type, 'planning');
        assert.equal(event.outcome, 'planned');
        assert.equal(
          events.some((entry) => entry.type === 'verification'),
          false,
        );

        if (event.type === 'planning') {
          assert.equal(event.evidence.fallbackReason, 'no_api_key');
          assert.equal(event.evidence.stepCount, 0);
        }
      },
    );
  });

  it('records prepared, approved, failed, and verified checks truthfully', async () => {
    const root = await makeProject();
    const store = createEvidenceStore();
    let exitCode = 3;

    const checkService = createCheckService({
      evidence: store,
      npm: {
        ok: true,
        runner: {
          nodePath: process.execPath,
          npmCli: 'npm-cli.js',
          directory: root,
        },
      },
      runner: async () => ({
        exitCode,
        signal: null,
        timedOut: false,
        durationMs: 5,
        stdout: `fixture-${exitCode}`,
        stderr: '',
        truncated: false,
      }),
    });

    await withApp({ evidence: store, checkService }, async (baseUrl) => {
      const prepare = await post(
        baseUrl,
        '/api/checks/prepare',
        { root, checkId: 'node-test' },
        headers(SESSION_A, { 'X-ANIRA-Approval': '1' }),
      );
      assert.equal(prepare.status, 200);

      const failed = await post(
        baseUrl,
        '/api/checks/run',
        { approvalId: prepare.body.approvalId },
        headers(SESSION_A, { 'X-ANIRA-Approval': '1' }),
      );
      assert.equal(failed.status, 200);
      assert.equal(failed.body.exitCode, 3);

      let events = (await timeline(baseUrl, SESSION_A)).events;
      const failedVerification = events.find(
        (event) => event.type === 'verification',
      );
      assert.equal(failedVerification?.outcome, 'failed');
      if (failedVerification?.type === 'verification') {
        assert.equal(failedVerification.evidence.exitCode, 3);
        assert.equal(failedVerification.evidence.coversPlanSteps, false);
      }
    assert.equal(
      events.some(
        (event) => event.outcome === 'verified' && event.type !== 'verification',
      ),
      false,
    );

      exitCode = 0;
      const prepareSuccess = await post(
        baseUrl,
        '/api/checks/prepare',
        { root, checkId: 'node-test' },
        headers(SESSION_A, { 'X-ANIRA-Approval': '1' }),
      );
      const success = await post(
        baseUrl,
        '/api/checks/run',
        { approvalId: prepareSuccess.body.approvalId },
        headers(SESSION_A, { 'X-ANIRA-Approval': '1' }),
      );
      assert.equal(success.status, 200);
      assert.equal(success.body.exitCode, 0);

      events = (await timeline(baseUrl, SESSION_A)).events;
      assert.equal(
        events.some(
          (event) => event.type === 'verification' && event.outcome === 'verified',
        ),
        true,
      );
      assert.equal(
        events.some(
          (event) => event.outcome === 'verified' && event.type !== 'verification',
        ),
        false,
      );

      const blocked = await post(
        baseUrl,
        '/api/checks/run',
        { approvalId: prepareSuccess.body.approvalId },
        headers(SESSION_A),
      );
      assert.equal(blocked.status, 403);

      events = (await timeline(baseUrl, SESSION_A)).events;
      const last = events[events.length - 1];
      assert.equal(last.type, 'failure');
      assert.equal(last.outcome, 'blocked');
      assert.equal(last.reason, 'approval_header_required');
    });
  });

  it('records edit preview, approval, application, rollback, and blocked changes', async () => {
    const root = await makeProject();
    const store = createEvidenceStore();
    const approvalHeaders = { 'X-ANIRA-Approval': '1' };

    await withApp({ evidence: store }, async (baseUrl) => {
      const prepare = await post(
        baseUrl,
        '/api/edits/prepare',
        {
          root,
          path: 'README.md',
          find: '# Evidence fixture',
          replace: '# Changed',
        },
        headers(SESSION_A, approvalHeaders),
      );
      assert.equal(prepare.status, 200);

      const applied = await post(
        baseUrl,
        '/api/edits/apply',
        { editId: prepare.body.editId },
        headers(SESSION_A, approvalHeaders),
      );
      assert.equal(applied.status, 200);

      let events = (await timeline(baseUrl, SESSION_A)).events;
      const planned = events.find((event) => event.type === 'edit');
      assert.equal(planned?.outcome, 'planned');
      const executed = events.filter(
        (event) => event.type === 'edit' && event.outcome === 'executed',
      );
      assert.equal(executed.length, 1);
      if (executed[0]?.type === 'edit') {
        assert.equal(executed[0].evidence.path, 'README.md');
        assert.equal(executed[0].evidence.beforeHash, prepare.body.beforeHash);
        assert.equal(executed[0].evidence.afterHash, prepare.body.afterHash);
      }

      const restored = await post(
        baseUrl,
        '/api/edits/rollback',
        { rollbackId: applied.body.rollbackId },
        headers(SESSION_A, approvalHeaders),
      );
      assert.equal(restored.status, 200);

      events = (await timeline(baseUrl, SESSION_A)).events;
      const recovered = events.find((event) => event.type === 'recovery');
      assert.equal(recovered?.outcome, 'recovered');
      if (recovered?.type === 'recovery') {
        assert.equal(recovered.evidence.restoredHash, prepare.body.beforeHash);
        assert.equal(recovered.evidence.verifiedHash, true);
      }

      const prepareBlocked = await post(
        baseUrl,
        '/api/edits/prepare',
        {
          root,
          path: 'README.md',
          find: '# Evidence fixture',
          replace: '# Blocked',
        },
        headers(SESSION_A, approvalHeaders),
      );
      assert.equal(prepareBlocked.status, 200);

      await fs.writeFile(path.join(root, 'README.md'), 'external change\n');

      const blocked = await post(
        baseUrl,
        '/api/edits/apply',
        { editId: prepareBlocked.body.editId },
        headers(SESSION_A, approvalHeaders),
      );
      assert.equal(blocked.status, 409);

      events = (await timeline(baseUrl, SESSION_A)).events;
      const last = events[events.length - 1];
      assert.equal(last.type, 'edit');
      assert.equal(last.outcome, 'blocked');
      assert.equal(last.reason, 'file_changed');
      assert.equal((await fs.readFile(path.join(root, 'README.md'), 'utf8')).trim(), 'external change');
    });
  });
});