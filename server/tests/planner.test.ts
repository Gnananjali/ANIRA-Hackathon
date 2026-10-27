import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { after, describe, it } from 'node:test';

import { createApp } from '../src/app';
import { derivePlanConstraints } from '../src/planner/constraints';
import { loadProviderConfig, type ModelClient } from '../src/planner/provider';
import { PlannerError, createPlannerService, isLoopbackBaseUrl } from '../src/planner/service';

const scratch: string[] = [];

async function makeProject(
  manifest: Record<string, unknown> = {
    name: 'planner-fixture',
    private: true,
    scripts: { test: 'node -e "process.exit(0)"' },
  },
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anira-planner-'));
  scratch.push(root);
  await fs.mkdir(path.join(root, 'client', 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(root, 'client', 'src', 'App.tsx'), 'export {};');
  await fs.writeFile(path.join(root, 'README.md'), '# Fixture\n');
  return root;
}

function validPlan() {
  return {
    summary: 'Read the app entry and run the project tests.',
    steps: [
      {
        id: 'inspect-app',
        title: 'Read the app entry',
        description: 'Read the main React component.',
        dependsOn: [],
        risk: 'low',
        action: { type: 'read', path: 'client/src/App.tsx' },
        verification: ['The path exists in the scan'],
        evidence: ['client/src/App.tsx'],
      },
      {
        id: 'run-tests',
        title: 'Run project tests',
        description: 'Propose running the allowlisted project check.',
        dependsOn: ['inspect-app'],
        risk: 'medium',
        action: { type: 'check', checkId: 'node-test' },
        verification: ['Exit code is 0'],
        evidence: ['package.json'],
      },
    ],
    assumptions: ['The test script covers the app.'],
    unknowns: ['Runtime behavior was not inspected.'],
  };
}

function clientFor(payload: unknown, model = 'fake-model'): ModelClient {
  return {
    model,
    complete: async () => JSON.stringify(payload),
  };
}

function rawClient(text: string): ModelClient {
  return {
    model: 'fake-model',
    complete: async () => text,
  };
}

function throwingClient(): ModelClient {
  return {
    model: 'fake-model',
    complete: async () => {
      throw new Error('simulated provider failure');
    },
  };
}

function hangingClient(): ModelClient {
  return {
    model: 'fake-model',
    complete: () => new Promise(() => undefined),
  };
}

async function startApp(options?: Parameters<typeof createApp>[0]) {
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

async function postPlan(
  baseUrl: string,
  body: unknown,
  headers: Record<string, string> = { 'Content-Type': 'application/json' },
) {
  const response = await fetch(`${baseUrl}/api/plan`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = (() => {
    try {
      return JSON.parse(text) as Record<string, any>;
    } catch {
      return {} as Record<string, any>;
    }
  })();

  return {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    body: payload,
  };
}

after(async () => {
  await Promise.all(
    scratch.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('provider configuration', () => {
  it('returns null without a key or model', () => {
    assert.equal(loadProviderConfig({} as NodeJS.ProcessEnv), null);
    assert.equal(
      loadProviderConfig({ ANIRA_PLANNER_API_KEY: 'k' } as NodeJS.ProcessEnv),
      null,
    );
  });

  it('uses the local Ollama default and numeric overrides', () => {
    const config = loadProviderConfig({
      ANIRA_PLANNER_API_KEY: 'k',
      ANIRA_PLANNER_MODEL: 'm',
      ANIRA_PLANNER_TIMEOUT_MS: '15000',
      ANIRA_PLANNER_MAX_TOKENS: '900',
    } as NodeJS.ProcessEnv);

    assert.ok(config);
    assert.equal(config.baseUrl, 'http://127.0.0.1:11434/v1');
    assert.equal(config.model, 'm');
    assert.equal(config.timeoutMs, 15000);
    assert.equal(config.maxTokens, 900);
  });
});

describe('constraints', () => {
  it('derives read-only and partial constraints', () => {
    const readOnly = derivePlanConstraints('Read-only review of the client.');
    assert.equal(readOnly.forbidEdits, true);
    assert.equal(readOnly.forbidExecution, true);

    const noEdits = derivePlanConstraints('Do not edit any files, but run the tests.');
    assert.equal(noEdits.forbidEdits, true);
    assert.equal(noEdits.forbidExecution, false);

    const noExecution = derivePlanConstraints('Do not run any commands.');
    assert.equal(noExecution.forbidExecution, true);
  });
});

describe('planner service', () => {
  it('falls back without calling the model when no client is configured', async () => {
    const service = createPlannerService({
      client: null,
      inspect: async () => {
        throw new Error('inspection must not run');
      },
    });

    const result = await service.plan({ root: 'C:\\anywhere', brief: 'Review the app.' });
    assert.deepEqual(result, { planner: 'deterministic', reason: 'no_api_key' });
  });

  it('returns a validated AI plan with topological step order', async () => {
    const root = await makeProject();
    const plan = validPlan();
    plan.steps.reverse();
    const service = createPlannerService({ client: clientFor(plan) });

    const result = await service.plan({
      root,
      brief: 'Review the app and run the tests.',
    });

    assert.equal(result.planner, 'ai');
    if (result.planner !== 'ai') return;
    assert.equal(result.model, 'fake-model');
    assert.deepEqual(result.steps.map((step) => step.id), ['inspect-app', 'run-tests']);
    assert.deepEqual(result.steps[1].dependsOn, ['inspect-app']);
    assert.equal(result.steps[0].action.type, 'read');
    assert.equal(result.steps[1].action.type, 'check');
    assert.deepEqual(result.assumptions, ['The test script covers the app.']);
    assert.deepEqual(result.unknowns, ['Runtime behavior was not inspected.']);
    assert.equal(result.inspected.name, path.basename(root));
  });

  it('tolerates a JSON markdown fence', async () => {
    const root = await makeProject();
    const service = createPlannerService({
      client: rawClient('```json\n' + JSON.stringify(validPlan()) + '\n```'),
    });

    const result = await service.plan({ root, brief: 'Review the app and run the tests.' });
    assert.equal(result.planner, 'ai');
  });

  it('falls back for malformed JSON', async () => {
    const root = await makeProject();
    const service = createPlannerService({ client: rawClient('not json') });

    const result = await service.plan({ root, brief: 'Review the app.' });
    assert.deepEqual(result, {
      planner: 'deterministic',
      reason: 'invalid_output',
      inspected: { name: path.basename(root), totalFiles: 3, truncated: false },
    });
  });

  it('rejects schema violations', async () => {
    const root = await makeProject();
    const cases: unknown[] = [
      { ...validPlan(), extra: true },
      {
        ...validPlan(),
        steps: [{ ...validPlan().steps[0], verification: [] }],
      },
      {
        ...validPlan(),
        steps: [{ ...validPlan().steps[0], surprise: 'x' }],
      },
      {
        ...validPlan(),
        steps: [validPlan().steps[0], { ...validPlan().steps[1], id: 'inspect-app' }],
      },
    ];

    for (const payload of cases) {
      const service = createPlannerService({ client: clientFor(payload) });
      const result = await service.plan({ root, brief: 'Review the app and run the tests.' });
      assert.equal(result.planner, 'deterministic');
      if (result.planner === 'deterministic') {
        assert.equal(result.reason, 'invalid_output');
      }
    }
  });

  it('rejects invalid dependency graphs', async () => {
    const root = await makeProject();
    const step = validPlan().steps[0];

    const cases = [
      { ...step, id: 'a', dependsOn: ['missing'] },
      { ...step, id: 'a', dependsOn: ['a'] },
      { ...step, id: 'a', dependsOn: ['b'] },
      { ...step, id: 'b', dependsOn: ['a'] },
    ];

    const unknown = createPlannerService({
      client: clientFor({ ...validPlan(), steps: [cases[0]] }),
    });
    assert.equal((await unknown.plan({ root, brief: 'Review the app.' })).planner, 'deterministic');

    const self = createPlannerService({
      client: clientFor({ ...validPlan(), steps: [cases[1]] }),
    });
    assert.equal((await self.plan({ root, brief: 'Review the app.' })).planner, 'deterministic');

    const cycle = createPlannerService({
      client: clientFor({ ...validPlan(), steps: [cases[2], cases[3]] }),
    });
    const cycleResult = await cycle.plan({ root, brief: 'Review the app.' });
    assert.equal(cycleResult.planner, 'deterministic');
    if (cycleResult.planner === 'deterministic') {
      assert.equal(cycleResult.reason, 'invalid_output');
    }
  });

  it('rejects unsafe actions and extra command fields', async () => {
    const root = await makeProject();
    const base = validPlan().steps[0];

    const cases = [
      { ...base, action: { type: 'shell', command: 'rm -rf /' } },
      { ...base, action: { type: 'read', path: 'README.md', command: 'echo hacked' } },
    ];

    for (const step of cases) {
      const service = createPlannerService({
        client: clientFor({ ...validPlan(), steps: [step] }),
      });
      const result = await service.plan({ root, brief: 'Review the app.' });
      assert.equal(result.planner, 'deterministic');
      if (result.planner === 'deterministic') {
        assert.equal(result.reason, 'unsafe_plan');
      }
    }
  });

  it('rejects actions forbidden by the brief', async () => {
    const root = await makeProject();
    const editStep = {
      ...validPlan().steps[0],
      id: 'edit-readme',
      action: { type: 'edit', path: 'README.md' },
      evidence: ['README.md'],
    };
    const checkStep = validPlan().steps[1];

    const editService = createPlannerService({
      client: clientFor({ ...validPlan(), steps: [editStep] }),
    });
    const editResult = await editService.plan({
      root,
      brief: 'Review the app. Do not edit anything.',
    });
    assert.equal(editResult.planner, 'deterministic');
    if (editResult.planner === 'deterministic') {
      assert.equal(editResult.reason, 'unsafe_plan');
    }

    const checkService = createPlannerService({
      client: clientFor({ ...validPlan(), steps: [checkStep] }),
    });
    const checkResult = await checkService.plan({
      root,
      brief: 'Review the app. Do not run any commands.',
    });
    assert.equal(checkResult.planner, 'deterministic');
    if (checkResult.planner === 'deterministic') {
      assert.equal(checkResult.reason, 'unsafe_plan');
    }
  });

  it('rejects a check when no test script exists', async () => {
    const root = await makeProject({ name: 'no-test', scripts: {} });
    const service = createPlannerService({
      client: clientFor({ ...validPlan(), steps: [validPlan().steps[1]] }),
    });

    const result = await service.plan({ root, brief: 'Review the app and run the tests.' });
    assert.equal(result.planner, 'deterministic');
    if (result.planner === 'deterministic') {
      assert.equal(result.reason, 'unsafe_plan');
    }
  });

  it('rejects evidence paths outside the scan', async () => {
    const root = await makeProject();
    const step = {
      ...validPlan().steps[0],
      evidence: ['src/missing.ts'],
    };
    const service = createPlannerService({
      client: clientFor({ ...validPlan(), steps: [step] }),
    });

    const result = await service.plan({ root, brief: 'Review the app.' });
    assert.equal(result.planner, 'deterministic');
    if (result.planner === 'deterministic') {
      assert.equal(result.reason, 'unsafe_plan');
    }
  });

  it('rejects dangerous instruction text', async () => {
    const root = await makeProject();
    const step = {
      ...validPlan().steps[0],
      description: 'Run rm -rf / to clean the machine.',
    };
    const service = createPlannerService({
      client: clientFor({ ...validPlan(), steps: [step] }),
    });

    const result = await service.plan({ root, brief: 'Review the app.' });
    assert.equal(result.planner, 'deterministic');
    if (result.planner === 'deterministic') {
      assert.equal(result.reason, 'unsafe_plan');
    }
  });

  it('falls back on model failure', async () => {
    const root = await makeProject();
    const service = createPlannerService({ client: throwingClient() });

    const result = await service.plan({ root, brief: 'Review the app.' });
    assert.equal(result.planner, 'deterministic');
    if (result.planner === 'deterministic') {
      assert.equal(result.reason, 'model_error');
    }
  });

  it('falls back on timeout', { timeout: 20_000 }, async () => {
    const root = await makeProject();
    const service = createPlannerService({
      client: hangingClient(),
      timeoutMs: 20,
    });

    const result = await service.plan({ root, brief: 'Review the app.' });
    assert.equal(result.planner, 'deterministic');
    if (result.planner === 'deterministic') {
      assert.equal(result.reason, 'timeout');
    }
  });

  it('rate limits planning requests', async () => {
    const root = await makeProject();
    const service = createPlannerService({
      client: clientFor(validPlan()),
      rateLimit: { maxRequests: 2, windowMs: 60_000 },
    });

    await service.plan({ root, brief: 'Review the app and run the tests.' });
    await service.plan({ root, brief: 'Review the app and run the tests.' });

    await assert.rejects(
      service.plan({ root, brief: 'Review the app and run the tests.' }),
      (error: unknown) =>
        error instanceof PlannerError &&
        error.code === 'plan_rate_limited' &&
        error.status === 429 &&
        (error.retryAfterMs ?? 0) > 0,
    );
  });

  it('allows one plan at a time', { timeout: 20_000 }, async () => {
    const root = await makeProject();
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const client: ModelClient = {
      model: 'fake-model',
      complete: async () => {
        started();
        await gate;
        return JSON.stringify(validPlan());
      },
    };

    const service = createPlannerService({
      client,
      rateLimit: { maxRequests: 10, windowMs: 60_000 },
    });

    const first = service.plan({ root, brief: 'Review the app and run the tests.' });
    await startedPromise;

    await assert.rejects(
      service.plan({ root, brief: 'Review the app and run the tests.' }),
      (error: unknown) =>
        error instanceof PlannerError && error.code === 'plan_in_progress',
    );

    release();
    const result = await first;
    assert.equal(result.planner, 'ai');
  });
});

describe('planner status', () => {
  it('reports unavailable without a client', () => {
    const service = createPlannerService({ client: null });
    assert.deepEqual(service.status(), { available: false, provider: 'none' });
  });

  it('reports local and external providers', () => {
    const local = createPlannerService({
      client: { model: 'llama', complete: async () => '' },
      providerInfo: { provider: 'local', model: 'llama' },
    });
    assert.deepEqual(local.status(), {
      available: true,
      provider: 'local',
      model: 'llama',
    });

    const external = createPlannerService({
      client: { model: 'remote', complete: async () => '' },
      providerInfo: { provider: 'external', model: 'remote' },
    });
    assert.deepEqual(external.status(), {
      available: true,
      provider: 'external',
      model: 'remote',
    });
  });

  it('detects loopback base URLs', () => {
    assert.equal(isLoopbackBaseUrl('http://127.0.0.1:11434/v1'), true);
    assert.equal(isLoopbackBaseUrl('http://localhost:11434/v1'), true);
    assert.equal(isLoopbackBaseUrl('http://[::1]:11434/v1'), true);
    assert.equal(isLoopbackBaseUrl('https://openrouter.ai/api/v1'), false);
    assert.equal(isLoopbackBaseUrl('not a url'), false);
  });

  it('serves the status without an approval header and rejects a bad origin', async () => {
    const app = await startApp({
      plannerService: createPlannerService({
        client: { model: 'llama', complete: async () => '' },
        providerInfo: { provider: 'local', model: 'llama' },
      }),
    });

    try {
      const ok = await fetch(`${app.baseUrl}/api/plan/config`);
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), {
        available: true,
        provider: 'local',
        model: 'llama',
      });

      const blocked = await fetch(`${app.baseUrl}/api/plan/config`, {
        headers: { Origin: 'https://evil.example' },
      });
      assert.equal(blocked.status, 403);
    } finally {
      await app.close();
    }
  });
});

describe('plan route', () => {
  it('does not require the approval header', async () => {
    const app = await startApp({
      plannerService: createPlannerService({ client: null }),
    });

    try {
      const result = await postPlan(
        app.baseUrl,
        { root: 'C:\\anywhere', brief: 'Review the app.' },
        { 'Content-Type': 'application/json' },
      );

      assert.equal(result.status, 200);
      assert.equal(result.body.planner, 'deterministic');
      assert.equal(result.body.reason, 'no_api_key');
    } finally {
      await app.close();
    }
  });

  it('rejects a disallowed origin', async () => {
    const app = await startApp({
      plannerService: createPlannerService({ client: null }),
    });

    try {
      const result = await postPlan(
        app.baseUrl,
        { root: 'C:\\anywhere', brief: 'Review the app.' },
        {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
        },
      );

      assert.equal(result.status, 403);
      assert.equal(result.body.error, 'origin_not_allowed');
    } finally {
      await app.close();
    }
  });

  it('rejects an empty brief', async () => {
    const app = await startApp({
      plannerService: createPlannerService({ client: null }),
    });

    try {
      const result = await postPlan(app.baseUrl, { root: 'C:\\anywhere', brief: '' });
      assert.equal(result.status, 400);
      assert.equal(result.body.error, 'invalid_request');
    } finally {
      await app.close();
    }
  });

  it('returns 429 with Retry-After', async () => {
    const root = await makeProject();
    const app = await startApp({
      plannerService: createPlannerService({
        client: clientFor(validPlan()),
        rateLimit: { maxRequests: 1, windowMs: 60_000 },
      }),
    });

    try {
      const first = await postPlan(app.baseUrl, {
        root,
        brief: 'Review the app and run the tests.',
      });
      assert.equal(first.status, 200);

      const second = await postPlan(app.baseUrl, {
        root,
        brief: 'Review the app and run the tests.',
      });
      assert.equal(second.status, 429);
      assert.equal(second.body.error, 'plan_rate_limited');
      assert.ok(Number(second.retryAfter) >= 1);
    } finally {
      await app.close();
    }
  });
});