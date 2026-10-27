import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface NpmRunner {
  /** Absolute path to the node executable that should run npm. */
  nodePath: string;
  /** Absolute path to npm-cli.js. */
  npmCli: string;
  /** Directory containing npm.cmd and node.exe. */
  directory: string;
}

export type NpmLookup =
  | { ok: true; runner: NpmRunner }
  | { ok: false; reason: 'unsupported_platform' | 'npm_not_found' };

/**
 * Resolves npm without relying on PATH lookup from the project directory.
 *
 * `where.exe npm.cmd` runs outside the inspected repo, so a package-local
 * npm.cmd cannot be picked up. The CLI is then invoked as an absolute path
 * with an absolute node executable, never through a shell.
 */
export function resolveNpmRunner(): NpmLookup {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'unsupported_platform' };
  }

  const result = spawnSync('where.exe', ['npm.cmd'], {
    encoding: 'utf8',
    timeout: 2_000,
    windowsHide: true,
  });

  if (result.status !== 0 || !result.stdout) {
    return { ok: false, reason: 'npm_not_found' };
  }

  const npmCmd = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!npmCmd) {
    return { ok: false, reason: 'npm_not_found' };
  }

  const directory = path.dirname(npmCmd);
  const npmCli = path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js');

  if (!existsSync(npmCli)) {
    return { ok: false, reason: 'npm_not_found' };
  }

  const localNode = path.join(directory, 'node.exe');

  return {
    ok: true,
    runner: {
      directory,
      npmCli,
      nodePath: existsSync(localNode) ? localNode : process.execPath,
    },
  };
}