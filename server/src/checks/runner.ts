import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import type { NpmRunner } from './npm';

export interface RunOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface RunResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export class CheckStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckStartError';
  }
}

const PASS_THROUGH_ENV = [
  'SystemRoot',
  'SystemDrive',
  'ComSpec',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'USERNAME',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'PATHEXT',
] as const;

/**
 * A deliberately small environment. Parent secrets such as API keys and
 * NODE_OPTIONS are not forwarded, and npm writes its cache under the OS temp
 * directory rather than the user's profile.
 */
export function buildChildEnv(runner: NpmRunner): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of PASS_THROUGH_ENV) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  env.PATH = [
    path.dirname(runner.nodePath),
    runner.directory,
    process.env.PATH ?? '',
  ]
    .filter((part) => part.length > 0)
    .join(path.delimiter);

  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  env.npm_config_cache = path.join(os.tmpdir(), 'anira-npm-cache');
  env.npm_config_update_notifier = 'false';
  env.npm_config_fund = 'false';
  env.npm_config_audit = 'false';
  env.npm_config_progress = 'false';

  return env;
}

function killTree(pid: number | undefined): void {
  if (!pid) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // The process may already be gone.
  }
}

/**
 * Runs exactly `npm test` in `cwd` with the resolved absolute npm CLI.
 * No shell, no request-supplied arguments, no stdin.
 */
export function runNpmTest(
  runner: NpmRunner,
  cwd: string,
  options: RunOptions,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(runner.nodePath, [runner.npmCli, 'test'], {
      cwd,
      env: buildChildEnv(runner),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    function collect(chunks: Buffer[], chunk: Buffer): void {
      const remaining = options.maxOutputBytes - totalBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }

      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        totalBytes += remaining;
        truncated = true;
        return;
      }

      chunks.push(chunk);
      totalBytes += chunk.length;
    }

    child.stdout?.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on('data', (chunk: Buffer) => collect(stderr, chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, options.timeoutMs);

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new CheckStartError(error.message));
    });

    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      resolve({
        exitCode: code,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated,
      });
    });
  });
}