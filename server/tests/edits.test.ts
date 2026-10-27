import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';

import { createApp, type AppOptions } from '../src/app';
import { createEditService } from '../src/edits/service';
import { writeFileAtomic } from '../src/edits/writer';

const HEADERS = {
  'Content-Type': 'application/json',
  'X-ANIRA-Approval': '1',
};

let shared: { baseUrl: string; close: () => Promise<void> };
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

async function makeRoot(files: Record<string, string | Buffer> = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anira-edit-'));
  scratch.push(root);

  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative.split('/').join(path.sep));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
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

  return { status: response.status, body: json as Record<string, any> };
}

async function prepare(
  baseUrl: string,
  root: string,
  relative: string,
  find: string,
  replace: string,
  headers: Record<string, string> = HEADERS,
) {
  return post(
    baseUrl,
    '/api/edits/prepare',
    { root, path: relative, find, replace },
    headers,
  );
}

async function apply(baseUrl: string, editId: unknown, extra: Record<string, unknown> = {}) {
  return post(baseUrl, '/api/edits/apply', { editId, ...extra });
}

async function rollback(baseUrl: string, rollbackId: unknown) {
  return post(baseUrl, '/api/edits/rollback', { rollbackId });
}

async function read(root: string, relative: string): Promise<Buffer> {
  return fs.readFile(path.join(root, relative.split('/').join(path.sep)));
}

async function tempFiles(root: string): Promise<string[]> {
  return (await fs.readdir(root)).filter((name) => name.startsWith('.anira-edit-'));
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

describe('edit approval guard', () => {
  it('requires the approval header', async () => {
    const root = await makeRoot({ 'a.txt': 'hello' });
    const result = await prepare(shared.baseUrl, root, 'a.txt', 'hello', 'bye', {
      'Content-Type': 'application/json',
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'approval_header_required');
  });

  it('rejects a disallowed origin', async () => {
    const root = await makeRoot({ 'a.txt': 'hello' });
    const result = await prepare(shared.baseUrl, root, 'a.txt', 'hello', 'bye', {
      ...HEADERS,
      Origin: 'https://evil.example',
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'origin_not_allowed');
  });

  it('rejects a disallowed origin on apply', async () => {
    const root = await makeRoot({ 'a.txt': 'hello' });
    const prepared = await prepare(shared.baseUrl, root, 'a.txt', 'hello', 'bye');

    const result = await post(
      shared.baseUrl,
      '/api/edits/apply',
      { editId: prepared.body.editId },
      { ...HEADERS, Origin: 'https://evil.example' },
    );

    assert.equal(result.status, 403);
    assert.equal(result.body.error, 'origin_not_allowed');
  });
});

describe('edit path safety', () => {
  it('rejects traversal and absolute paths', async () => {
    const root = await makeRoot({ 'a.txt': 'hello', 'outside.txt': 'secret' });

    const traversal = await prepare(shared.baseUrl, root, '../outside.txt', 'secret', 'x');
    assert.equal(traversal.status, 400);
    assert.equal(traversal.body.error, 'invalid_path');

    const absolute = await prepare(
      shared.baseUrl,
      root,
      path.join(root, 'a.txt'),
      'hello',
      'bye',
    );
    assert.equal(absolute.status, 400);
    assert.equal(absolute.body.error, 'invalid_path');
  });

  it('rejects ignored folders in any case', async () => {
    const root = await makeRoot({ 'node_modules/dep/a.js': 'module.exports = 1;' });

    for (const relative of ['node_modules/dep/a.js', 'NODE_MODULES/dep/a.js']) {
      const result = await prepare(shared.baseUrl, root, relative, '1', '2');
      assert.equal(result.status, 400, relative);
      assert.equal(result.body.error, 'ignored_path', relative);
    }
  });

  it('rejects missing files and directories', async () => {
    const root = await makeRoot({ 'sub/keep.txt': 'x' });

    const missing = await prepare(shared.baseUrl, root, 'nope.txt', 'x', 'y');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'not_found');

    const directory = await prepare(shared.baseUrl, root, 'sub', 'x', 'y');
    assert.equal(directory.status, 400);
    assert.equal(directory.body.error, 'not_a_file');
  });

  it('rejects binary and invalid UTF-8 files', async () => {
    const binaryRoot = await makeRoot({ 'bin.dat': Buffer.from([0x61, 0x00, 0x62]) });
    const binary = await prepare(shared.baseUrl, binaryRoot, 'bin.dat', 'a', 'b');
    assert.equal(binary.status, 400);
    assert.equal(binary.body.error, 'unsupported_file');
    assert.equal(binary.body.reason, 'binary');

    const invalidRoot = await makeRoot({ 'bad.txt': Buffer.from([0x61, 0xff, 0x62]) });
    const invalid = await prepare(shared.baseUrl, invalidRoot, 'bad.txt', 'a', 'b');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'unsupported_file');
    assert.equal(invalid.body.reason, 'invalid_utf8');
  });

  it('rejects files over the size cap', async () => {
    const root = await makeRoot({ 'big.txt': 'a'.repeat(128) });
    const app = await startApp({
      editService: createEditService({ maxFileBytes: 64 }),
    });

    try {
      const result = await prepare(app.baseUrl, root, 'big.txt', 'a', 'b');
      assert.equal(result.status, 400);
      assert.equal(result.body.error, 'unsupported_file');
      assert.equal(result.body.reason, 'too_large');
    } finally {
      await app.close();
    }
  });

  it('rejects a symlinked file', async (t) => {
    const root = await makeRoot({ 'real.txt': 'hello' });
    const outside = await makeRoot({ 'outside.txt': 'secret' });

    try {
      await fs.symlink(path.join(outside, 'outside.txt'), path.join(root, 'link.txt'), 'file');
    } catch {
      t.skip('file symlink creation is not permitted on this machine');
      return;
    }

    const result = await prepare(shared.baseUrl, root, 'link.txt', 'secret', 'x');
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'unsafe_path');
  });

  it('rejects a target behind a junctioned parent', async (t) => {
    const root = await makeRoot({ 'safe.txt': 'ok' });
    const outside = await makeRoot({ 'secret.txt': 'secret' });

    try {
      await fs.symlink(outside, path.join(root, 'link'), 'junction');
    } catch {
      t.skip('junction creation is not permitted on this machine');
      return;
    }

    const result = await prepare(shared.baseUrl, root, 'link/secret.txt', 'secret', 'x');
    assert.equal(result.status, 400);
    assert.ok(['unsafe_path', 'invalid_path'].includes(result.body.error));
  });
});

describe('edit preview', () => {
  it('builds a single-line preview', async () => {
    const root = await makeRoot({ 'a.txt': 'one\ntwo\nthree\n' });
    const result = await prepare(shared.baseUrl, root, 'a.txt', 'two', 'TWO');

    assert.equal(result.status, 200);
    assert.equal(result.body.path, 'a.txt');
    assert.equal(result.body.diff.startLine, 2);
    assert.equal(result.body.diff.startColumn, 1);
    assert.deepEqual(result.body.diff.removed, ['two']);
    assert.deepEqual(result.body.diff.added, ['TWO']);
    assert.deepEqual(result.body.diff.contextBefore, ['one']);
    assert.deepEqual(result.body.diff.contextAfter, ['three']);
    assert.equal(result.body.diff.lineEnding, 'LF');
    assert.match(result.body.beforeHash, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(result.body.beforeHash, result.body.afterHash);
  });

  it('represents a partial-line replacement as full lines', async () => {
    const root = await makeRoot({ 'a.txt': 'abcXYZdef\nnext\n' });
    const result = await prepare(shared.baseUrl, root, 'a.txt', 'XYZ', 'Q');

    assert.equal(result.body.diff.startLine, 1);
    assert.equal(result.body.diff.startColumn, 4);
    assert.deepEqual(result.body.diff.removed, ['abcXYZdef']);
    assert.deepEqual(result.body.diff.added, ['abcQdef']);
  });

  it('represents a multi-line replacement', async () => {
    const root = await makeRoot({ 'a.txt': 'a\nb\nc\n' });
    const result = await prepare(shared.baseUrl, root, 'a.txt', 'a\nb', 'A');

    assert.deepEqual(result.body.diff.removed, ['a', 'b']);
    assert.deepEqual(result.body.diff.added, ['A']);
    assert.deepEqual(result.body.diff.contextAfter, ['c']);
  });

  it('rejects no-match, ambiguous, and no-change edits', async () => {
    const root = await makeRoot({ 'a.txt': 'alpha beta alpha\n' });

    const missing = await prepare(shared.baseUrl, root, 'a.txt', 'gamma', 'x');
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'no_match');

    const ambiguous = await prepare(shared.baseUrl, root, 'a.txt', 'alpha', 'x');
    assert.equal(ambiguous.status, 400);
    assert.equal(ambiguous.body.error, 'ambiguous_change');

    const noChange = await prepare(shared.baseUrl, root, 'a.txt', 'beta', 'beta');
    assert.equal(noChange.status, 400);
    assert.equal(noChange.body.error, 'no_change');

    const empty = await prepare(shared.baseUrl, root, 'a.txt', '', 'x');
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, 'invalid_change');
  });
});

describe('edit apply and rollback', () => {
  it('applies exact bytes and leaves no temp files', async () => {
    const root = await makeRoot({ 'a.txt': 'one\ntwo\nthree\n' });
    const prepared = await prepare(shared.baseUrl, root, 'a.txt', 'two', 'TWO');

    const applied = await apply(shared.baseUrl, prepared.body.editId);
    assert.equal(applied.status, 200);
    assert.equal(applied.body.applied, true);
    assert.equal(applied.body.beforeHash, prepared.body.beforeHash);
    assert.equal(applied.body.afterHash, prepared.body.afterHash);

    assert.equal((await read(root, 'a.txt')).toString('utf8'), 'one\nTWO\nthree\n');
    assert.deepEqual(await tempFiles(root), []);
  });

  it('preserves a BOM and CRLF byte-for-byte', async () => {
    const original = '\uFEFFline1\r\nline2\r\nline3\r\n';
    const expected = '\uFEFFline1\r\nLINE2\r\nline3\r\n';
    const root = await makeRoot({ 'crlf.txt': original });

    const prepared = await prepare(shared.baseUrl, root, 'crlf.txt', 'line2', 'LINE2');
    assert.equal(prepared.status, 200);
    assert.equal(prepared.body.diff.lineEnding, 'CRLF');

    const applied = await apply(shared.baseUrl, prepared.body.editId);
    assert.equal(applied.status, 200);

    const bytes = await read(root, 'crlf.txt');
    assert.deepEqual(bytes, Buffer.from(expected, 'utf8'));
    assert.equal(bytes[0], 0xef);
    assert.equal(bytes[1], 0xbb);
    assert.equal(bytes[2], 0xbf);
  });

  it('rolls back to the exact original bytes', async () => {
    const original = Buffer.from('one\r\ntwo\r\n', 'utf8');
    const root = await makeRoot({ 'a.txt': original });
    const prepared = await prepare(shared.baseUrl, root, 'a.txt', 'two', 'TWO');
    const applied = await apply(shared.baseUrl, prepared.body.editId);

    assert.equal(applied.status, 200);
    assert.notDeepEqual(await read(root, 'a.txt'), original);

    const restored = await rollback(shared.baseUrl, applied.body.rollbackId);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.rolledBack, true);
    assert.equal(restored.body.restoredHash, prepared.body.beforeHash);
    assert.deepEqual(await read(root, 'a.txt'), original);
  });

  it('refuses to apply after an external change', async () => {
    const root = await makeRoot({ 'a.txt': 'original\n' });
    const prepared = await prepare(shared.baseUrl, root, 'a.txt', 'original', 'edited');

    await fs.writeFile(path.join(root, 'a.txt'), 'external\n');

    const applied = await apply(shared.baseUrl, prepared.body.editId);
    assert.equal(applied.status, 409);
    assert.equal(applied.body.error, 'file_changed');
    assert.equal((await read(root, 'a.txt')).toString('utf8'), 'external\n');

    const retry = await apply(shared.baseUrl, prepared.body.editId);
    assert.equal(retry.status, 400);
    assert.equal(retry.body.error, 'approval_invalid');
  });

  it('refuses to roll back after an external change', async () => {
    const root = await makeRoot({ 'a.txt': 'original\n' });
    const prepared = await prepare(shared.baseUrl, root, 'a.txt', 'original', 'edited');
    const applied = await apply(shared.baseUrl, prepared.body.editId);

    await fs.writeFile(path.join(root, 'a.txt'), 'external\n');

    const restored = await rollback(shared.baseUrl, applied.body.rollbackId);
    assert.equal(restored.status, 409);
    assert.equal(restored.body.error, 'file_changed');
    assert.equal((await read(root, 'a.txt')).toString('utf8'), 'external\n');
  });

  it('expires approvals and rollbacks', { timeout: 20_000 }, async () => {
    const root = await makeRoot({ 'a.txt': 'original\n' });
    const app = await startApp({
      editService: createEditService({ approvalTtlMs: 20, rollbackTtlMs: 20 }),
    });

    try {
      const prepared = await prepare(app.baseUrl, root, 'a.txt', 'original', 'edited');
      await new Promise((resolve) => setTimeout(resolve, 80));

      const expired = await apply(app.baseUrl, prepared.body.editId);
      assert.equal(expired.status, 410);
      assert.equal(expired.body.error, 'approval_expired');

      const fresh = await prepare(app.baseUrl, root, 'a.txt', 'original', 'edited');
      const applied = await apply(app.baseUrl, fresh.body.editId);
      assert.equal(applied.status, 200);

      await new Promise((resolve) => setTimeout(resolve, 80));
      const expiredRollback = await rollback(app.baseUrl, applied.body.rollbackId);
      assert.equal(expiredRollback.status, 410);
      assert.equal(expiredRollback.body.error, 'rollback_expired');
    } finally {
      await app.close();
    }
  });

  it('consumes approvals and rollbacks exactly once', async () => {
    const root = await makeRoot({ 'a.txt': 'original\n' });
    const prepared = await prepare(shared.baseUrl, root, 'a.txt', 'original', 'edited');
    const applied = await apply(shared.baseUrl, prepared.body.editId);
    assert.equal(applied.status, 200);

    const secondApply = await apply(shared.baseUrl, prepared.body.editId);
    assert.equal(secondApply.status, 400);
    assert.equal(secondApply.body.error, 'approval_invalid');

    const restored = await rollback(shared.baseUrl, applied.body.rollbackId);
    assert.equal(restored.status, 200);

    const secondRollback = await rollback(shared.baseUrl, applied.body.rollbackId);
    assert.equal(secondRollback.status, 400);
    assert.equal(secondRollback.body.error, 'rollback_invalid');
  });

  it('ignores client-supplied root, path, hashes, and operation', async () => {
    const root = await makeRoot({ 'a.txt': 'original\n' });
    const prepared = await prepare(shared.baseUrl, root, 'a.txt', 'original', 'edited');

    const applied = await apply(shared.baseUrl, prepared.body.editId, {
      root: 'C:\\Windows',
      path: 'win.ini',
      beforeHash: 'sha256:fake',
      afterHash: 'sha256:fake',
      operation: 'delete',
    });

    assert.equal(applied.status, 200);
    assert.equal((await read(root, 'a.txt')).toString('utf8'), 'edited\n');
  });

  it('rejects concurrent edits', { timeout: 20_000 }, async () => {
    const root = await makeRoot({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
    const app = await startApp({
      editService: createEditService({
        writer: async (target, data) => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          await writeFileAtomic(target, data);
        },
      }),
    });

    try {
      const first = await prepare(app.baseUrl, root, 'a.txt', 'a', 'A');
      const second = await prepare(app.baseUrl, root, 'b.txt', 'b', 'B');

      const running = apply(app.baseUrl, first.body.editId);
      await new Promise((resolve) => setTimeout(resolve, 60));

      const blocked = await apply(app.baseUrl, second.body.editId);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.error, 'edit_in_progress');

      const finished = await running;
      assert.equal(finished.status, 200);
    } finally {
      await app.close();
    }
  });

  it('reports write failure without changing the file', { timeout: 20_000 }, async () => {
    const root = await makeRoot({ 'a.txt': 'original\n' });
    const app = await startApp({
      editService: createEditService({
        writer: async () => {
          throw new Error('simulated write failure');
        },
      }),
    });

    try {
      const prepared = await prepare(app.baseUrl, root, 'a.txt', 'original', 'edited');
      const applied = await apply(app.baseUrl, prepared.body.editId);

      assert.equal(applied.status, 500);
      assert.equal(applied.body.error, 'write_failed');
      assert.equal((await read(root, 'a.txt')).toString('utf8'), 'original\n');
      assert.deepEqual(await tempFiles(root), []);
    } finally {
      await app.close();
    }
  });
});

describe('atomic writer', () => {
  it('cleans up the temporary file when the rename fails', async () => {
    const root = await makeRoot({ 'keep.txt': 'x' });
    await fs.mkdir(path.join(root, 'target-directory'));

    await assert.rejects(
      writeFileAtomic(path.join(root, 'target-directory'), Buffer.from('data')),
    );

    assert.deepEqual(await tempFiles(root), []);
  });
});