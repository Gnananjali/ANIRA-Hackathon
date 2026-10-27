import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { after, describe, it } from 'node:test';

import { createApp, type AppOptions } from '../src/app';
import { createEditService } from '../src/edits/service';
import { writeFileAtomic } from '../src/edits/writer';
import { createEvidenceStore } from '../src/evidence/store';
import type { EvidenceEvent } from '../src/evidence/schema';

const SESSION = 'recovery-session-0001';
const HEADERS = {
  'Content-Type': 'application/json',
  'X-ANIRA-Approval': '1',
  'X-ANIRA-Session': SESSION,
};
const scratch: string[] = [];

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

async function makeRoot(content = 'one\ntwo\n'): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anira-recovery-'));
  scratch.push(root);
  await fs.writeFile(path.join(root, 'a.txt'), content);
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

  return { status: response.status, body: json as Record<string, any> };
}

async function timeline(baseUrl: string): Promise<EvidenceEvent[]> {
  const response = await fetch(`${baseUrl}/api/evidence`, {
    headers: { 'X-ANIRA-Session': SESSION },
  });
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { events: EvidenceEvent[] };
  return payload.events;
}

async function prepare(baseUrl: string, root: string) {
  return post(baseUrl, '/api/edits/prepare', {
    root,
    path: 'a.txt',
    find: 'two',
    replace: 'TWO',
  });
}

async function apply(baseUrl: string, editId: unknown) {
  return post(baseUrl, '/api/edits/apply', { editId });
}

async function rollback(baseUrl: string, rollbackId: unknown) {
  return post(baseUrl, '/api/edits/rollback', { rollbackId });
}

async function read(root: string): Promise<string> {
  return fs.readFile(path.join(root, 'a.txt'), 'utf8');
}

function recoveryEvent(events: EvidenceEvent[]) {
  return [...events].reverse().find((event) => event.type === 'recovery');
}

after(async () => {
  await Promise.all(
    scratch.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('verified recovery', () => {
  it('restores the original bytes and records verified hash recovery', async () => {
    const store = createEvidenceStore();
    const app = await startApp({ evidence: store });

    try {
      const root = await makeRoot();
      const prepared = await prepare(app.baseUrl, root);
      const applied = await apply(app.baseUrl, prepared.body.editId);
      assert.equal(applied.status, 200);

      const restored = await rollback(app.baseUrl, applied.body.rollbackId);
      assert.equal(restored.status, 200);
      assert.equal(restored.body.rolledBack, true);
      assert.equal(restored.body.verifiedHash, true);
      assert.equal(restored.body.restoredHash, prepared.body.beforeHash);
      assert.equal(await read(root), 'one\ntwo\n');

      const event = recoveryEvent(await timeline(app.baseUrl));
      assert.equal(event?.outcome, 'recovered');
      if (event?.type === 'recovery') {
        assert.equal(event.evidence.verifiedHash, true);
        assert.equal(event.evidence.restoredHash, prepared.body.beforeHash);
      }
    } finally {
      await app.close();
    }
  });

  it('refuses rollback after an external hash conflict', async () => {
    const store = createEvidenceStore();
    const app = await startApp({ evidence: store });

    try {
      const root = await makeRoot();
      const prepared = await prepare(app.baseUrl, root);
      const applied = await apply(app.baseUrl, prepared.body.editId);
      assert.equal(applied.status, 200);

      await fs.writeFile(path.join(root, 'a.txt'), 'external\n');

      const restored = await rollback(app.baseUrl, applied.body.rollbackId);
      assert.equal(restored.status, 409);
      assert.equal(restored.body.error, 'file_changed');
      assert.equal(await read(root), 'external\n');

      const event = recoveryEvent(await timeline(app.baseUrl));
      assert.equal(event?.outcome, 'blocked');
      assert.equal(event?.reason, 'file_changed');
      if (event?.type === 'recovery') {
        assert.equal(event.evidence.verifiedHash, false);
      }
    } finally {
      await app.close();
    }
  });

  it('reports a rollback write failure without claiming recovery', async () => {
    const store = createEvidenceStore();
    let writes = 0;
    const editService = createEditService({
      evidence: store,
      writer: async (target, data) => {
        writes += 1;
        if (writes === 1) {
          await writeFileAtomic(target, data);
          return;
        }
        throw new Error('simulated rollback write failure');
      },
    });
    const app = await startApp({ evidence: store, editService });

    try {
      const root = await makeRoot();
      const prepared = await prepare(app.baseUrl, root);
      const applied = await apply(app.baseUrl, prepared.body.editId);
      assert.equal(applied.status, 200);

      const restored = await rollback(app.baseUrl, applied.body.rollbackId);
      assert.equal(restored.status, 500);
      assert.equal(restored.body.error, 'write_failed');
      assert.equal(await read(root), 'one\nTWO\n');

      const event = recoveryEvent(await timeline(app.baseUrl));
      assert.equal(event?.outcome, 'failed');
      assert.equal(event?.reason, 'write_failed');
      if (event?.type === 'recovery') {
        assert.equal(event.evidence.verifiedHash, false);
      }
    } finally {
      await app.close();
    }
  });

  it('fails verification when restored bytes do not match the original hash', async () => {
    const store = createEvidenceStore();
    let writes = 0;
    const editService = createEditService({
      evidence: store,
      writer: async (target, data) => {
        writes += 1;
        await writeFileAtomic(
          target,
          writes === 1 ? data : Buffer.from('corrupted\n', 'utf8'),
        );
      },
    });
    const app = await startApp({ evidence: store, editService });

    try {
      const root = await makeRoot();
      const prepared = await prepare(app.baseUrl, root);
      const applied = await apply(app.baseUrl, prepared.body.editId);
      assert.equal(applied.status, 200);

      const restored = await rollback(app.baseUrl, applied.body.rollbackId);
      assert.equal(restored.status, 500);
      assert.equal(restored.body.error, 'rollback_verification_failed');
      assert.equal(restored.body.reason, 'hash_mismatch');
      assert.equal(await read(root), 'corrupted\n');

      const event = recoveryEvent(await timeline(app.baseUrl));
      assert.equal(event?.outcome, 'failed');
      assert.equal(event?.reason, 'hash_mismatch');
      if (event?.type === 'recovery') {
        assert.equal(event.evidence.verifiedHash, false);
        assert.equal(event.evidence.restoredHash, undefined);
      }
      assert.equal(
        (await timeline(app.baseUrl)).some(
          (entry) => entry.type === 'recovery' && entry.outcome === 'recovered',
        ),
        false,
      );
    } finally {
      await app.close();
    }
  });

  it('rejects an expired rollback without attempting a restore', async () => {
    const store = createEvidenceStore();
    const editService = createEditService({
      approvalTtlMs: 1_000,
      rollbackTtlMs: 20,
      evidence: store,
    });
    const app = await startApp({ evidence: store, editService });

    try {
      const root = await makeRoot();
      const prepared = await prepare(app.baseUrl, root);
      const applied = await apply(app.baseUrl, prepared.body.editId);
      assert.equal(applied.status, 200);

      await new Promise((resolve) => setTimeout(resolve, 80));

      const restored = await rollback(app.baseUrl, applied.body.rollbackId);
      assert.equal(restored.status, 410);
      assert.equal(restored.body.error, 'rollback_expired');
      assert.equal(await read(root), 'one\nTWO\n');

      const events = await timeline(app.baseUrl);
      const failure = [...events]
        .reverse()
        .find((event) => event.type === 'failure');
      assert.equal(failure?.outcome, 'blocked');
      assert.equal(failure?.reason, 'rollback_expired');
      assert.equal(
        events.some(
          (event) => event.type === 'recovery' && event.outcome === 'recovered',
        ),
        false,
      );
    } finally {
      await app.close();
    }
  });
});