import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface CheckDefinition {
  id: string;
  label: string;
  command: string;
  description: string;
}

/**
 * The only commands ANIRA may run. This list is frozen: a request supplies a
 * check id, never a command, and the mapping lives here on the server.
 */
export const CHECK_CATALOG: readonly CheckDefinition[] = Object.freeze([
  Object.freeze({
    id: 'node-test',
    label: 'Run project tests',
    command: 'npm test',
    description: 'Runs the project’s own npm test script.',
  }),
]);

export class CheckError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly reason?: string,
  ) {
    super(code);
    this.name = 'CheckError';
  }
}

const MAX_PATH_LENGTH = 4096;
const MAX_MANIFEST_BYTES = 64 * 1024;

export type TestScriptState =
  | 'ready'
  | 'missing_manifest'
  | 'invalid_manifest'
  | 'missing_script';

export function findCheck(input: unknown): CheckDefinition {
  if (typeof input !== 'string') {
    throw new CheckError('check_not_found', 400);
  }

  const check = CHECK_CATALOG.find((entry) => entry.id === input);
  if (!check) {
    throw new CheckError('check_not_found', 400);
  }

  return check;
}

export async function resolveCheckRoot(input: unknown): Promise<string> {
  if (typeof input !== 'string') {
    throw new CheckError('invalid_path', 400);
  }

  let value = input.trim();

  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).trim();
  }

  if (!value || value.length > MAX_PATH_LENGTH || value.includes('\0')) {
    throw new CheckError('invalid_path', 400);
  }

  if (value.startsWith('\\\\') || !path.isAbsolute(value)) {
    throw new CheckError('invalid_path', 400);
  }

  let stats;
  try {
    stats = await fs.stat(value);
  } catch {
    throw new CheckError('not_found', 404);
  }

  if (!stats.isDirectory()) {
    throw new CheckError('not_a_directory', 400);
  }

  try {
    return await fs.realpath(value);
  } catch {
    throw new CheckError('not_found', 404);
  }
}

/** Reads only package.json, with a size cap, to see whether a test script exists. */
export async function inspectTestScript(root: string): Promise<TestScriptState> {
  const manifestPath = path.join(root, 'package.json');

  let raw: string;
  try {
    const stats = await fs.stat(manifestPath);
    if (!stats.isFile() || stats.size > MAX_MANIFEST_BYTES) {
      return 'missing_manifest';
    }
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    return 'missing_manifest';
  }

  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    const test = parsed?.scripts?.test;
    return typeof test === 'string' && test.trim().length > 0 ? 'ready' : 'missing_script';
  } catch {
    return 'invalid_manifest';
  }
}