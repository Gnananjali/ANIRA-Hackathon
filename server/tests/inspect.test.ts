import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../src/app';
import type { InspectionResult } from '../src/services/inspectRepository';
import { INSPECT_LIMITS, inspectRepository, isPathInside } from '../src/services/inspectRepository';

let server: Server | undefined;
let baseUrl = '';
let fixture = '';
let outside = '';
let symlinkCreated = false;

async function writeFile(relative: string, content = 'x'): Promise<void> {
  const target = path.join(fixture, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function inspect(
  folder: unknown,
): Promise<{ status: number; body: InspectionResult | { error: string } }> {
  const response = await fetch(`${baseUrl}/api/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folder }),
  });

  return {
    status: response.status,
    body: (await response.json()) as InspectionResult | { error: string },
  };
}

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => {
    server?.once('listening', () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'anira-inspect-'));
  await writeFile('package.json', '{"name":"fixture"}');
  await writeFile('tsconfig.json', '{}');
  await writeFile('README.md', '# fixture');
  await writeFile('src/index.ts', 'export const value = 1;');
  await writeFile('src/App.tsx', 'export function App() { return null; }');
  await writeFile('notes.txt', 'TOP_SECRET_MARKER');
  await writeFile('node_modules/dep/index.js', 'module.exports = {};');
  await writeFile('.git/config', '[core]');
  await writeFile('dist/bundle.js', 'console.log("built");');
  await writeFile('build/out.js', 'console.log("built");');

  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'anira-outside-'));
  await fs.writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE_SECRET');

  try {
    await fs.symlink(outside, path.join(fixture, 'escape'), 'junction');
    symlinkCreated = true;
  } catch {
    symlinkCreated = false;
  }
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  }

  await fs.rm(fixture, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe('path containment', () => {
  const root = path.resolve(os.tmpdir(), 'anira-root');

  it('accepts strict descendants', () => {
    assert.equal(isPathInside(root, path.join(root, 'src', 'index.ts')), true);
    assert.equal(isPathInside(root, path.join(root, '..foo')), true);
  });

  it('rejects the root itself and traversal', () => {
    assert.equal(isPathInside(root, root), false);
    assert.equal(isPathInside(root, path.join(root, '..', 'secret.txt')), false);
    assert.equal(
      isPathInside(root, path.join(path.dirname(root), 'anira-root-2', 'index.ts')),
      false,
    );
  });
});

describe('repository inspection', () => {
  it('lists files, detects the stack, and skips ignored directories', async () => {
    const { status, body } = await inspect(fixture);

    assert.equal(status, 200);
    const result = body as InspectionResult;

    const paths = result.files.map((file) => file.path);
    assert.ok(paths.includes('package.json'));
    assert.ok(paths.includes('tsconfig.json'));
    assert.ok(paths.includes('src/index.ts'));
    assert.ok(paths.includes('src/App.tsx'));
    assert.ok(paths.every((file) => !file.startsWith('node_modules/')));
    assert.ok(paths.every((file) => !file.startsWith('.git/')));
    assert.ok(paths.every((file) => !file.startsWith('dist/')));
    assert.ok(paths.every((file) => !file.startsWith('build/')));

    assert.deepEqual(result.ignored, ['.git', 'build', 'dist', 'node_modules']);

    const stackNames = result.stack.map((signal) => signal.name);
    assert.ok(stackNames.includes('Node.js'));
    assert.ok(stackNames.includes('TypeScript'));
    assert.ok(stackNames.includes('React'));

    const typescript = result.languages.find((language) => language.name === 'TypeScript');
    assert.equal(typescript?.files, 2);
  });

  it('returns metadata only, never file contents', async () => {
    const { body } = await inspect(fixture);
    const serialized = JSON.stringify(body);

    assert.equal(serialized.includes('TOP_SECRET_MARKER'), false);
    assert.equal(serialized.includes('OUTSIDE_SECRET'), false);

    const result = body as InspectionResult;
    for (const file of result.files) {
      assert.deepEqual(Object.keys(file).sort(), [
        'extension',
        'name',
        'path',
        'sizeBytes',
      ]);
    }
  });

  it('does not follow a directory escape', async (t) => {
    if (!symlinkCreated) {
      t.skip('symlink/junction creation is not permitted on this machine');
      return;
    }

    const { body } = await inspect(fixture);
    const result = body as InspectionResult;

    assert.ok(result.files.every((file) => !file.path.startsWith('escape/')));
    assert.equal(result.files.some((file) => file.name === 'secret.txt'), false);
  });

  it('rejects relative and missing paths', async () => {
    assert.equal((await inspect('relative/folder')).status, 400);
    assert.deepEqual((await inspect('relative/folder')).body, { error: 'invalid_path' });

    assert.equal((await inspect(undefined)).status, 400);
    assert.deepEqual((await inspect(undefined)).body, { error: 'invalid_path' });
  });

  it('rejects UNC paths', async () => {
    const { status, body } = await inspect('\\\\server\\share');
    assert.equal(status, 400);
    assert.deepEqual(body, { error: 'invalid_path' });
  });

  it('rejects file paths', async () => {
    const { status, body } = await inspect(path.join(fixture, 'package.json'));
    assert.equal(status, 400);
    assert.deepEqual(body, { error: 'not_a_directory' });
  });

  it('returns 404 for a missing folder', async () => {
    const { status, body } = await inspect(path.join(fixture, 'does-not-exist'));
    assert.equal(status, 404);
    assert.deepEqual(body, { error: 'not_found' });
  });
});

describe('scan limits', () => {
  const scratch: string[] = [];

  async function makeTree(
    files: string[],
    prefix = 'anira-limits-',
  ): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    scratch.push(root);

    for (const relative of files) {
      const target = path.join(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'x');
    }

    return root;
  }

  after(async () => {
    await Promise.all(scratch.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('stops at the file limit and reports truncation', async () => {
    const root = await makeTree(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']);
    const result = await inspectRepository(root, { maxFiles: 3 });

    assert.equal(result.files.length, 3);
    assert.equal(result.totalFiles, 3);
    assert.equal(result.truncated, true);
  });

  it('does not report truncation when the tree ends exactly on the limit', async () => {
    const root = await makeTree(['a.ts', 'b.ts', 'c.ts']);
    const result = await inspectRepository(root, { maxFiles: 3 });

    assert.equal(result.totalFiles, 3);
    assert.equal(result.truncated, false);
  });

  it('respects the directory limit', async () => {
    const root = await makeTree(['one/a.ts', 'two/b.ts', 'three/c.ts']);
    const result = await inspectRepository(root, { maxDirectories: 1 });

    assert.equal(result.truncated, true);
    assert.equal(result.files.length, 0);
  });

  it('respects the depth limit and omits deeper files', async () => {
    const root = await makeTree(['a/b/kept.ts', 'a/b/c/lost.ts']);
    const result = await inspectRepository(root, { maxDepth: 2 });

    assert.equal(result.truncated, true);
    assert.ok(result.files.some((file) => file.path === 'a/b/kept.ts'));
    assert.equal(result.files.some((file) => file.path === 'a/b/c/lost.ts'), false);
  });

  it('exposes the production defaults', () => {
    assert.equal(INSPECT_LIMITS.maxFiles, 2000);
    assert.equal(INSPECT_LIMITS.maxDirectories, 5000);
    assert.equal(INSPECT_LIMITS.maxDepth, 12);
  });
});

describe('ignored folders', () => {
  const scratch: string[] = [];

  after(async () => {
    await Promise.all(scratch.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('ignores the four folders at any depth and in any case', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anira-ignore-'));
    scratch.push(root);

    const files = [
      'src/index.ts',
      'packages/app/node_modules/dep/index.js',
      'packages/app/src/main.ts',
      'deep/nested/.git/config',
      'client/Dist/bundle.js',
      'client/BUILD/out.js',
      'Client/dist/other.js',
    ];

    for (const relative of files) {
      const target = path.join(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'x');
    }

    const result = await inspectRepository(root);
    const paths = result.files.map((file) => file.path);

    assert.ok(paths.includes('src/index.ts'));
    assert.ok(paths.includes('packages/app/src/main.ts'));
    assert.equal(paths.some((file) => file.includes('node_modules')), false);
    assert.equal(paths.some((file) => file.includes('.git')), false);
    assert.equal(paths.some((file) => /(^|\/)[Dd]ist(\/|$)/.test(file)), false);
    assert.equal(paths.some((file) => /(^|\/)[Bb][Uu][Ii][Ll][Dd](\/|$)/.test(file)), false);

    assert.deepEqual(result.ignored, ['.git', 'build', 'dist', 'node_modules']);
  });

  it('reports the stack from manifests and config files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anira-stack-'));
    scratch.push(root);

    for (const relative of [
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'src/App.tsx',
      'Dockerfile',
      'go.mod',
      'requirements.txt',
    ]) {
      const target = path.join(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'x');
    }

    const result = await inspectRepository(root);
    const names = result.stack.map((signal) => signal.name);

    for (const expected of ['Node.js', 'TypeScript', 'React', 'Vite', 'Docker', 'Go', 'Python']) {
      assert.ok(names.includes(expected), `missing stack signal: ${expected}`);
    }

    // Every signal must point at the file that produced it.
    const packageSignal = result.stack.find((signal) => signal.name === 'Node.js');
    assert.equal(packageSignal?.reason, 'package.json');
    for (const signal of result.stack) {
      assert.ok(signal.reason.length > 0, `signal ${signal.name} has no evidence`);
    }
  });

  it('caps the number of reported stack signals', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anira-stackcap-'));
    scratch.push(root);

    for (const relative of [
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'next.config.js',
      'angular.json',
      'tailwind.config.ts',
      'requirements.txt',
      'go.mod',
      'Cargo.toml',
      'composer.json',
      'Dockerfile',
      'pubspec.yaml',
      'prisma/schema.prisma',
      '.github/workflows/ci.yml',
      'src/App.tsx',
    ]) {
      const target = path.join(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'x');
    }

    const result = await inspectRepository(root);

    assert.ok(result.stack.length > 0);
    assert.ok(result.stack.length <= 12, `expected at most 12 signals, got ${result.stack.length}`);
  });
});