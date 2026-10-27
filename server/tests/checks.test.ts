import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../src/app';
import { createCheckService } from '../src/checks/service';
import { CheckStartError, runNpmTest } from '../src/checks/runner';

const HEADERS = {
  'Content-Type': 'application/json',
  'X-ANIRA-Approval': '1',
};

let shared: { baseUrl: string; close: () => Promise<void> };
const scratch: string[] = [];

async function startApp(
  options?: Parameters<typeof createApp>[0],
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
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

interface FixtureOptions {
  script?: string;
  manifest?: Record<string, unknown> | null;
}

async function makeFixture(options: FixtureOptions = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anira-check-'));
  scratch.push(root);

  if (options.manifest !== null) {
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify(
        options.manifest ?? {
          name: 'anira-check-fixture',
          private: true,
          scripts: { test: 'node test.js' },
        },
      ),
    );
  }

  if (options.script !== undefined) {
    await fs.writeFile(path.join(root, 'test.js'), options.script);
  }

  return root;
}

async function post(
  baseUrl: string,
  route: string,
  body: unknown,
  headers: Record<string, string> = HEADERS,
) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: response.status, body: json as Record<string, any>, text };
}

async function prepare(
  baseUrl: string,
  root: string,
  checkId: unknown = 'node-test',
  headers: Record<string, string> = HEADERS,
) {
  return post(baseUrl, '/api/checks/prepare', { root, checkId }, headers);
}

async function run(
  baseUrl: string,
  approvalId: unknown,
  headers: Record<string, string> = HEADERS,
  extra: Record<string, unknown> = {},
) {
  return post(baseUrl, '/api/checks/run', { approvalId, ...extra }, headers);
}

before(async () => {
  shared = await startApp();
});

after(async () => {
  await shared.close();
  await Promise.all(
    scratch.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('check preparation', () => {
  it('rejects an unknown check id', async () => {
    const root = await makeFixture({ script: 'process.exit(0);' });
    const result = await prepare(shared.baseUrl, root, 'rm-rf');

    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'check_not_found');
  });

  it('rejects relative and missing roots', async () => {
    const relative = await prepare(shared.baseUrl, 'relative/folder');
    assert.equal(relative.status, 400);
    assert.equal(relative.body.error, 'invalid_path');

    const missing = await prepare(
      shared.baseUrl,
      path.join(os.tmpdir(), 'anira-does-not-exist'),
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'not_found');
  });

  it('requires a package.json with a test script', async () => {
    const noManifest = await makeFixture({ manifest: null, script: 'process.exit(0);' });
    const missing = await prepare(shared.baseUrl, noManifest);
    assert.equal(missing.status, 409);
    assert.equal(missing.body.error, 'check_unavailable');
    assert.equal(missing.body.reason, 'missing_manifest');

    const noScript = await makeFixture({
      manifest: { name: 'fixture', scripts: {} },
      script: 'process.exit(0);',
    });
    const absent = await prepare(shared.baseUrl, noScript);
    assert.equal(absent.status, 409);
    assert.equal(absent.body.reason, 'missing_script');

    const broken = await makeFixture({
      manifest: null,
      script: 'process.exit(0);',
    });
    await fs.writeFile(path.join(broken, 'package.json'), '{ not json');
    const invalid = await prepare(shared.baseUrl, broken);
    assert.equal(invalid.status, 409);
    assert.equal(invalid.body.reason, 'invalid_manifest');
  });

  it('returns the fixed command and an approval', async () => {
    const root = await makeFixture({ script: 'console.log("ok");' });
    const result = await prepare(shared.baseUrl, root);

    assert.equal(result.status, 200);
    assert.equal(typeof result.body.approvalId, 'string');
    assert.equal(result.body.check.id, 'node-test');
    assert.equal(result.body.check.command, 'npm test');
    assert.equal(result.body.root, await fs.realpath(root));

    const expires = Date.parse(result.body.expiresAt as string);
    assert.ok(expires > Date.now());
    assert.ok(expires <= Date.now() + 121_000);
  });
});

describe('approval guard', () => {
  it('requires the approval header', async () => {
    const root = await makeFixture({ script: 'process.exit(0);' });
    const result = await prepare(shared.baseUrl, root, 'node-test', {
      'Content-Type': 'application/json',
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'approval_header_required');
  });

  it('rejects a disallowed origin', async () => {
    const root = await makeFixture({ script: 'process.exit(0);' });
    const result = await prepare(shared.baseUrl, root, 'node-test', {
      ...HEADERS,
      Origin: 'https://evil.example',
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'origin_not_allowed');
  });

  it('allows the Vite dev origin', async () => {
    const root = await makeFixture({ script: 'process.exit(0);' });
    const result = await prepare(shared.baseUrl, root, 'node-test', {
      ...HEADERS,
      Origin: 'http://localhost:5173',
    });

    assert.equal(result.status, 200);
  });
});

describe('approval lifecycle', () => {
  it('rejects unknown approvals', async () => {
    const result = await run(shared.baseUrl, 'not-a-real-approval');
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'approval_invalid');
  });

  it('expires approvals after the TTL', async () => {
    const root = await makeFixture({ script: 'console.log("ok");' });
    const app = await startApp({
      checkService: createCheckService({ approvalTtlMs: 20 }),
    });

    try {
      const prepared = await prepare(app.baseUrl, root);
      assert.equal(prepared.status, 200);

      await new Promise((resolve) => setTimeout(resolve, 80));
      const result = await run(app.baseUrl, prepared.body.approvalId);

      assert.equal(result.status, 410);
      assert.equal(result.body.error, 'approval_expired');
    } finally {
      await app.close();
    }
  });

  it('consumes an approval exactly once', async () => {
    const root = await makeFixture({ script: 'console.log("once");' });
    const prepared = await prepare(shared.baseUrl, root);

    const first = await run(shared.baseUrl, prepared.body.approvalId);
    assert.equal(first.status, 200);

    const second = await run(shared.baseUrl, prepared.body.approvalId);
    assert.equal(second.status, 400);
    assert.equal(second.body.error, 'approval_invalid');
  });
});

describe('check execution', () => {
  it('returns exit 0 and real stdout for a passing script', { timeout: 20_000 }, async () => {
    const root = await makeFixture({
      script: 'console.log("fixture-stdout"); process.exit(0);',
    });
    const prepared = await prepare(shared.baseUrl, root);
    const result = await run(shared.baseUrl, prepared.body.approvalId);

    assert.equal(result.status, 200);
    assert.equal(result.body.checkId, 'node-test');
    assert.equal(result.body.command, 'npm test');
    assert.equal(result.body.exitCode, 0);
    assert.equal(result.body.timedOut, false);
    assert.match(result.body.stdout, /fixture-stdout/);
    assert.ok(result.body.durationMs >= 0);
    assert.equal('passed' in result.body, false);
  });

  it('returns the real non-zero exit code and never marks it passed', { timeout: 20_000 }, async () => {
    const root = await makeFixture({
      script: 'console.error("fixture-stderr"); process.exit(3);',
    });
    const prepared = await prepare(shared.baseUrl, root);
    const result = await run(shared.baseUrl, prepared.body.approvalId);

    assert.equal(result.status, 200);
    assert.equal(result.body.exitCode, 3);
    assert.equal(result.body.timedOut, false);
    assert.match(result.body.stderr, /fixture-stderr/);
    assert.equal('passed' in result.body, false);
  });

  it('ignores command fields supplied by the client', { timeout: 20_000 }, async () => {
    const root = await makeFixture({
      script: 'console.log("only-approved-command"); process.exit(0);',
    });
    const prepared = await prepare(shared.baseUrl, root);
    const result = await run(shared.baseUrl, prepared.body.approvalId, HEADERS, {
      command: 'echo hacked',
      args: ['/c', 'echo hacked'],
    });

    assert.equal(result.status, 200);
    assert.match(result.body.stdout, /only-approved-command/);
    assert.doesNotMatch(result.body.stdout, /hacked/);
  });

  it('runs in the approved root and drops parent secrets', { timeout: 20_000 }, async () => {
    const root = await makeFixture({
      script:
        'console.log("cwd=" + process.cwd()); console.log("sentinel=" + (process.env.ANIRA_SECRET_TEST ?? "absent"));',
    });

    process.env.ANIRA_SECRET_TEST = 'should-not-leak';
    try {
      const prepared = await prepare(shared.baseUrl, root);
      const result = await run(shared.baseUrl, prepared.body.approvalId);

      assert.equal(result.status, 200);
      assert.match(result.body.stdout, /sentinel=absent/);
      assert.doesNotMatch(result.body.stdout, /should-not-leak/);

      const resolved = (await fs.realpath(root)).toLowerCase();
      assert.match(result.body.stdout.toLowerCase(), new RegExp(`cwd=${resolved.replace(/\\/g, '\\\\')}`));
    } finally {
      delete process.env.ANIRA_SECRET_TEST;
    }
  });

  it('times out and reports an interrupted run', { timeout: 20_000 }, async () => {
    const root = await makeFixture({
      script: 'setTimeout(() => {}, 30_000);',
    });
    const app = await startApp({
      checkService: createCheckService({ timeoutMs: 800 }),
    });

    try {
      const prepared = await prepare(app.baseUrl, root);
      assert.equal(prepared.status, 200);

      const started = Date.now();
      const result = await run(app.baseUrl, prepared.body.approvalId);

      assert.equal(result.status, 200);
      assert.equal(result.body.timedOut, true);
      assert.equal(result.body.exitCode === 0, false);
      assert.equal('passed' in result.body, false);
      assert.ok(Date.now() - started < 10_000);
    } finally {
      await app.close();
    }
  });

  it('caps captured output', { timeout: 20_000 }, async () => {
    const root = await makeFixture({
      script: 'console.log("x".repeat(50_000)); process.exit(0);',
    });
    const app = await startApp({
      checkService: createCheckService({ maxOutputBytes: 1_024 }),
    });

    try {
      const prepared = await prepare(app.baseUrl, root);
      const result = await run(app.baseUrl, prepared.body.approvalId);

      assert.equal(result.status, 200);
      assert.equal(result.body.truncated, true);
      assert.ok(
        (result.body.stdout as string).length + (result.body.stderr as string).length <= 1_024,
      );
    } finally {
      await app.close();
    }
  });

  it('rejects a concurrent run for the same server', { timeout: 30_000 }, async () => {
    const root = await makeFixture({
      script: 'setTimeout(() => { console.log("slow-done"); process.exit(0); }, 1500);',
    });
    const first = await prepare(shared.baseUrl, root);
    const second = await prepare(shared.baseUrl, root);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const running = run(shared.baseUrl, first.body.approvalId);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const blocked = await run(shared.baseUrl, second.body.approvalId);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, 'run_in_progress');

    const finished = await running;
    assert.equal(finished.status, 200);
    assert.equal(finished.body.exitCode, 0);
  });

  it('leaves the project files untouched', { timeout: 20_000 }, async () => {
    const root = await makeFixture({
      script: 'console.log("read-only"); process.exit(0);',
    });
    const before = (await fs.readdir(root)).sort();
    const prepared = await prepare(shared.baseUrl, root);
    const result = await run(shared.baseUrl, prepared.body.approvalId);
    const after = (await fs.readdir(root)).sort();

    assert.equal(result.status, 200);
    assert.deepEqual(after, before);
  });
});

describe('failed startup', () => {
  it('maps a spawn failure to check_failed_to_start', { timeout: 20_000 }, async () => {
    const root = await makeFixture({ script: 'process.exit(0);' });
    const app = await startApp({
      checkService: createCheckService({
        npm: {
          ok: true,
          runner: { nodePath: 'missing-node.exe', npmCli: 'missing.js', directory: root },
        },
        runner: async () => {
          throw new CheckStartError('spawn missing-node.exe ENOENT');
        },
      }),
    });

    try {
      const prepared = await prepare(app.baseUrl, root);
      assert.equal(prepared.status, 200);

      const result = await run(app.baseUrl, prepared.body.approvalId);
      assert.equal(result.status, 500);
      assert.equal(result.body.error, 'check_failed_to_start');
      assert.equal('exitCode' in result.body, false);
      assert.equal('passed' in result.body, false);
    } finally {
      await app.close();
    }
  });

  it('rejects when the executable does not exist', async () => {
    await assert.rejects(
      runNpmTest(
        { nodePath: 'C:\\anira-missing\\node.exe', npmCli: 'missing.js', directory: 'C:\\anira-missing' },
        os.tmpdir(),
        { timeoutMs: 2_000, maxOutputBytes: 1_024 },
      ),
      (error: unknown) => error instanceof CheckStartError,
    );
  });
});