import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../src/app';

let server: Server | undefined;
let baseUrl = '';

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => {
    server?.once('listening', () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('GET /api/health', () => {
  it('returns JSON and reports scaffold capabilities', async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(response.headers.get('x-powered-by'), null);

    const body = (await response.json()) as {
      status: string;
      service: string;
      mode: string;
      capabilities: Record<string, boolean>;
    };

    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'anira-server');
    assert.equal(body.mode, 'scaffold');
    assert.deepEqual(body.capabilities, {
      execution: false,
      llm: false,
      voice: false,
      desktopControl: false,
    });
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const response = await fetch(`${baseUrl}/api/unknown`);

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await response.json(), { error: 'not_found' });
  });
});

describe('malformed JSON', () => {
  it('returns a safe JSON 400 without internals', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken":',
    });

    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);

    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { error: 'invalid_json' });
    assert.doesNotMatch(text, /SyntaxError|node_modules|JSON\.parse|[A-Za-z]:\\/);
  });
});

describe('oversized JSON', () => {
  it('returns a safe JSON 413 without internals', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'x'.repeat(70_000) }),
    });

    assert.equal(response.status, 413);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);

    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { error: 'payload_too_large' });
    assert.doesNotMatch(text, /PayloadTooLargeError|node_modules|[A-Za-z]:\\/);
  });
});

describe('CORS', () => {
  it('allows the dev origin', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'http://localhost:5173',
    );
  });

  it('does not grant other origins', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://example.com' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  it('answers preflight requests', async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
      },
    });

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'http://localhost:5173',
    );
  });
});