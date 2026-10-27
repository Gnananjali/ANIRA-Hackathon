import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  consentRequired,
  grantExternalConsent,
  clearExternalConsent,
  hasExternalConsent,
  type StorageLike,
} from '../src/consent';
import {
  EVIDENCE_SESSION_HEADER,
  EVIDENCE_SESSION_STORAGE_KEY,
  evidenceHeaders,
  getEvidenceSessionId,
} from '../src/evidenceSession';
import { buildAiReport, buildFallbackReport, fallbackLabel, mapAiSteps } from '../src/planMapping';
import {
  createSingleFlight,
  fetchPlannerConfig,
  requestPlan,
  type AiPlanResponse,
  type FetchLike,
} from '../src/plannerClient';
import type { PlanReport } from '../src/types';

const base: PlanReport = {
  brief: 'Review the app.',
  inspected: { name: 'demo', root: 'C:\\demo', totalFiles: 3, truncated: false },
  planner: 'deterministic',
  assumptions: [],
  unknowns: [],
  facts: [
    {
      label: 'Node.js',
      detail: 'package.json',
      meaning: 'The project is set up as a Node.js package.',
      evidence: ['package.json'],
      basis: 'fact',
    },
  ],
  inferences: [
    {
      label: 'Likely a browser front-end',
      detail: 'React files are present.',
      meaning: 'The repo appears to include a web interface.',
      evidence: ['client/src/App.tsx'],
      basis: 'inference',
    },
  ],
  limitations: ['File contents were not read; findings rely on names and sizes.'],
  steps: [],
  constraints: {
    readOnly: false,
    forbidEdits: false,
    forbidExecution: false,
    destructive: false,
  },
  note: 'Proposal-only plan. No files were modified and no checks were run.',
};

const aiResponse: AiPlanResponse = {
  planner: 'ai',
  model: 'fake-model',
  inspected: { name: 'demo', totalFiles: 3, truncated: false },
  summary: 'Read the app entry and run the approved check.',
  assumptions: [],
  unknowns: [],
  steps: [
    {
      id: 'read-app',
      title: 'Read the app entry',
      description: 'Read the main component.',
      dependsOn: [],
      risk: 'low',
      action: { type: 'read', path: 'client/src/App.tsx' },
      verification: ['The file exists in the scan'],
      evidence: ['client/src/App.tsx'],
    },
    {
      id: 'check-tests',
      title: 'Run tests',
      description: 'Propose the allowlisted check.',
      dependsOn: ['read-app'],
      risk: 'medium',
      action: { type: 'check', checkId: 'node-test' },
      verification: ['Exit code is 0'],
      evidence: ['package.json'],
    },
    {
      id: 'edit-readme',
      title: 'Edit README',
      description: 'Propose a documentation change.',
      dependsOn: ['read-app'],
      risk: 'medium',
      action: { type: 'edit', path: 'README.md' },
      verification: ['The diff matches the review'],
      evidence: ['README.md'],
    },
    {
      id: 'summarize',
      title: 'Summarize',
      description: 'Write a short summary.',
      dependsOn: ['check-tests', 'edit-readme'],
      risk: 'low',
      action: { type: 'report' },
      verification: ['Summary cites scanned paths'],
      evidence: [],
    },
    {
      id: 'manual-review',
      title: 'Manual review',
      description: 'Ask a human to confirm.',
      dependsOn: ['summarize'],
      risk: 'low',
      action: { type: 'manual' },
      verification: ['A human signs off'],
      evidence: [],
    },
  ],
};

function fakeFetch(status: number, payload: unknown): FetchLike {
  return async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    }) as unknown as Response;
}

function brokenJsonFetch(): FetchLike {
  return async () =>
    ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    }) as unknown as Response;
}

function rejectingFetch(): FetchLike {
  return async () => {
    throw new Error('offline');
  };
}

function hangingFetch(): FetchLike {
  return () => new Promise<Response>(() => undefined);
}

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('AI plan mapping', () => {
  it('maps every action type to a tool and kind', () => {
    const steps = mapAiSteps(aiResponse.steps);
    const byId = new Map(steps.map((step) => [step.id, step]));

    assert.equal(byId.get('read-app')?.tool, 'filesystem.read');
    assert.equal(byId.get('read-app')?.kind, 'read');
    assert.equal(byId.get('check-tests')?.tool, 'checks.run');
    assert.equal(byId.get('check-tests')?.kind, 'execute');
    assert.equal(byId.get('edit-readme')?.tool, 'workspace.patch');
    assert.equal(byId.get('edit-readme')?.kind, 'write');
    assert.equal(byId.get('summarize')?.tool, 'report.compose');
    assert.equal(byId.get('summarize')?.kind, 'read');
    assert.equal(byId.get('manual-review')?.tool, 'human.review');
    assert.equal(byId.get('manual-review')?.kind, 'read');

    assert.deepEqual(byId.get('check-tests')?.dependsOn, ['read-app']);
    assert.deepEqual(byId.get('check-tests')?.verification, ['Exit code is 0']);
    assert.deepEqual(byId.get('check-tests')?.evidence, ['package.json']);
    assert.equal(byId.get('read-app')?.status, 'proposed');
  });

  it('builds an AI report without losing deterministic facts or limits', () => {
    const report = buildAiReport(base, aiResponse, 'external');

    assert.equal(report.planner, 'ai');
    assert.equal(report.plannerModel, 'fake-model');
    assert.equal(report.provider, 'external');
    assert.equal(report.summary, aiResponse.summary);
    assert.deepEqual(report.assumptions, []);
    assert.deepEqual(report.unknowns, []);
    assert.deepEqual(report.facts, base.facts);
    assert.deepEqual(report.inferences, base.inferences);
    assert.deepEqual(report.limitations, base.limitations);
    assert.equal(report.steps.length, 5);
    assert.equal(report.note, base.note);
  });

  it('builds a deterministic fallback report with a reason', () => {
    const report = buildFallbackReport(base, 'timeout');

    assert.equal(report.planner, 'deterministic');
    assert.equal(report.plannerReason, 'timeout');
    assert.deepEqual(report.facts, base.facts);
    assert.deepEqual(report.limitations, base.limitations);
    assert.deepEqual(report.steps, base.steps);
    assert.deepEqual(report.assumptions, []);
    assert.deepEqual(report.unknowns, []);
  });

  it('labels fallback reasons plainly', () => {
    assert.equal(fallbackLabel('no_api_key'), 'No AI provider configured');
    assert.equal(fallbackLabel('timeout'), 'AI planner timed out');
    assert.equal(fallbackLabel('user_declined_external'), 'You chose the local planner');
    assert.equal(fallbackLabel('unknown'), 'AI planner unavailable');
    assert.equal(fallbackLabel(undefined), 'AI planner unavailable');
  });
});

describe('planner client', () => {
  it('accepts a valid AI response', async () => {
    const result = await requestPlan(
      { root: 'C:\\demo', brief: 'Review the app.' },
      fakeFetch(200, aiResponse),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.response.planner, 'ai');
    }
  });

  it('accepts a deterministic response', async () => {
    const result = await requestPlan(
      { root: 'C:\\demo', brief: 'Review the app.' },
      fakeFetch(200, { planner: 'deterministic', reason: 'no_api_key' }),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.response.planner, 'deterministic');
    }
  });

  it('maps rate limits and failures without exposing details', async () => {
    const limited = await requestPlan({ root: 'C:\\demo', brief: 'x' }, fakeFetch(429, {}));
    assert.deepEqual(limited, { ok: false, reason: 'rate_limited' });

    const failed = await requestPlan(
      { root: 'C:\\demo', brief: 'x' },
      fakeFetch(500, { error: 'internal details' }),
    );
    assert.deepEqual(failed, { ok: false, reason: 'request_failed' });

    const offline = await requestPlan({ root: 'C:\\demo', brief: 'x' }, rejectingFetch());
    assert.deepEqual(offline, { ok: false, reason: 'request_failed' });
  });

  it('rejects malformed responses', async () => {
    const invalid = await requestPlan(
      { root: 'C:\\demo', brief: 'x' },
      fakeFetch(200, { planner: 'ai' }),
    );
    assert.deepEqual(invalid, { ok: false, reason: 'invalid_response' });

    const broken = await requestPlan({ root: 'C:\\demo', brief: 'x' }, brokenJsonFetch());
    assert.deepEqual(broken, { ok: false, reason: 'invalid_response' });
  });

  it('times out a hanging request', async () => {
    const result = await requestPlan(
      { root: 'C:\\demo', brief: 'x' },
      hangingFetch(),
      20,
    );
    assert.deepEqual(result, { ok: false, reason: 'request_failed' });
  });

  it('loads sanitized planner configuration', async () => {
    const external = await fetchPlannerConfig(
      fakeFetch(200, {
        available: true,
        provider: 'external',
        model: 'model-x',
        apiKey: 'must-not-leak',
      }),
    );
    assert.deepEqual(external, {
      available: true,
      provider: 'external',
      model: 'model-x',
    });

    const local = await fetchPlannerConfig(
      fakeFetch(200, { available: true, provider: 'local' }),
    );
    assert.deepEqual(local, { available: true, provider: 'local' });

    const unavailable = await fetchPlannerConfig(
      fakeFetch(200, { available: false, provider: 'none' }),
    );
    assert.deepEqual(unavailable, { available: false, provider: 'none' });

    assert.equal(await fetchPlannerConfig(fakeFetch(500, {})), null);
    assert.equal(await fetchPlannerConfig(fakeFetch(200, { provider: 'weird' })), null);
    assert.equal(await fetchPlannerConfig(rejectingFetch()), null);
    assert.equal(await fetchPlannerConfig(hangingFetch(), 20), null);
  });

  it('sends only the root and brief without an approval header', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;

    const fetchImpl: FetchLike = async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ planner: 'deterministic', reason: 'no_api_key' }),
      } as unknown as Response;
    };

    await requestPlan({ root: 'C:\\demo', brief: 'Review the app.' }, fetchImpl);

    assert.equal(seenUrl, '/api/plan');
    assert.equal(seenInit?.method, 'POST');
    assert.equal(new Headers(seenInit?.headers).has('X-ANIRA-Approval'), false);
    assert.equal(
      new Headers(seenInit?.headers).get(EVIDENCE_SESSION_HEADER),
      'anonymous',
    );
    assert.deepEqual(JSON.parse(String(seenInit?.body)), {
      root: 'C:\\demo',
      brief: 'Review the app.',
    });
  });

  it('prevents duplicate concurrent submissions while loading', async () => {
    const run = createSingleFlight();
    let release!: (value: string) => void;
    let calls = 0;

    const task = () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };

    const first = run(task);
    const second = run(task);

    assert.equal(await second, null);
    release('done');
    assert.equal(await first, 'done');
    assert.equal(calls, 1);
    assert.equal(await run(async () => 'again'), 'again');
  });
});

describe('consent', () => {
  it('requires consent only for external providers', () => {
    const storage = new MemoryStorage();

    assert.equal(consentRequired('external', storage), true);
    assert.equal(consentRequired('local', storage), false);
    assert.equal(consentRequired('none', storage), false);
    assert.equal(consentRequired('external', null), true);
  });

  it('remembers and clears consent', () => {
    const storage = new MemoryStorage();

    assert.equal(hasExternalConsent(storage), false);
    grantExternalConsent(storage);
    assert.equal(hasExternalConsent(storage), true);
    assert.equal(consentRequired('external', storage), false);

    clearExternalConsent(storage);
    assert.equal(hasExternalConsent(storage), false);
  });
});

describe('evidence session', () => {
  it('keeps one browser-session id and reuses it', () => {
    const storage = new MemoryStorage();

    const first = getEvidenceSessionId(storage, () => 'session-test-0001');
    const second = getEvidenceSessionId(storage, () => 'session-other-0002');

    assert.equal(first, 'session-test-0001');
    assert.equal(second, first);
    assert.equal(storage.getItem(EVIDENCE_SESSION_STORAGE_KEY), first);
  });

  it('replaces an invalid stored id and falls back without storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(EVIDENCE_SESSION_STORAGE_KEY, 'bad');

    const id = getEvidenceSessionId(storage, () => 'session-test-0003');
    assert.equal(id, 'session-test-0003');
    assert.equal(storage.getItem(EVIDENCE_SESSION_STORAGE_KEY), id);
    assert.equal(getEvidenceSessionId(null), 'anonymous');
    assert.equal(
      evidenceHeaders({ Accept: 'application/json' })[EVIDENCE_SESSION_HEADER],
      'anonymous',
    );
  });
});