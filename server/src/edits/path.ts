import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Stats } from 'node:fs';
import path from 'node:path';

import { isPathInside } from '../services/inspectRepository';

export const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'build']);
export const MAX_FILE_BYTES_DEFAULT = 256 * 1024;
export const MAX_SNIPPET_BYTES = 32 * 1024;

const MAX_PATH_LENGTH = 4096;

export class EditError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly reason?: string,
  ) {
    super(code);
    this.name = 'EditError';
  }
}

export function sha256(buffer: Buffer): string {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

export function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export async function resolveEditRoot(input: unknown): Promise<string> {
  if (typeof input !== 'string') {
    throw new EditError('invalid_path', 400);
  }

  let value = input.trim();

  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).trim();
  }

  if (!value || value.length > MAX_PATH_LENGTH || value.includes('\0')) {
    throw new EditError('invalid_path', 400);
  }

  if (value.startsWith('\\\\') || !path.isAbsolute(value)) {
    throw new EditError('invalid_path', 400);
  }

  let stats;
  try {
    stats = await fs.stat(value);
  } catch {
    throw new EditError('not_found', 404);
  }

  if (!stats.isDirectory()) {
    throw new EditError('not_a_directory', 400);
  }

  try {
    return await fs.realpath(value);
  } catch {
    throw new EditError('not_found', 404);
  }
}

/**
 * Accepts only a clean relative path with no `.`/`..` segments, no drive or
 * UNC prefix, and no ignored folder anywhere in the path.
 */
export function normalizeRelativePath(input: unknown): string {
  if (typeof input !== 'string') {
    throw new EditError('invalid_path', 400);
  }

  const value = input.trim();

  if (!value || value.length > MAX_PATH_LENGTH || value.includes('\0')) {
    throw new EditError('invalid_path', 400);
  }

  if (
    path.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value) ||
    value.startsWith('\\\\') ||
    value.startsWith('/')
  ) {
    throw new EditError('invalid_path', 400);
  }

  const segments = value.split(/[\\/]+/);

  if (segments.some((segment) => segment === '.' || segment === '..' || segment.length === 0)) {
    throw new EditError('invalid_path', 400);
  }

  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment.toLowerCase()))) {
    throw new EditError('ignored_path', 400);
  }

  return segments.join(path.sep);
}

export interface EditTarget {
  absolutePath: string;
  stats: Stats;
}

/**
 * Resolves the real target and its real parent, rejecting symlinks, symlinked
 * parents, directories, and anything outside the root.
 */
export async function resolveEditTarget(
  root: string,
  relativePath: string,
): Promise<EditTarget> {
  const candidate = path.resolve(root, relativePath);

  if (!isPathInside(root, candidate)) {
    throw new EditError('invalid_path', 400);
  }

  let parentReal: string;
  try {
    parentReal = await fs.realpath(path.dirname(candidate));
  } catch {
    throw new EditError('not_found', 404);
  }

  if (!samePath(parentReal, root) && !isPathInside(root, parentReal)) {
    throw new EditError('unsafe_path', 400, 'parent_outside_root');
  }
  let lstat;
  try {
    lstat = await fs.lstat(candidate);
  } catch {
    throw new EditError('not_found', 404);
  }

  if (lstat.isSymbolicLink()) {
    throw new EditError('unsafe_path', 400, 'symlink');
  }

  if (!lstat.isFile()) {
    throw new EditError('not_a_file', 400);
  }

  let realTarget: string;
  try {
    realTarget = await fs.realpath(candidate);
  } catch {
    throw new EditError('not_found', 404);
  }

  if (!isPathInside(root, realTarget)) {
    throw new EditError('unsafe_path', 400, 'outside_root');
  }

  const stats = await fs.stat(realTarget);

  if (!stats.isFile()) {
    throw new EditError('not_a_file', 400);
  }

  return { absolutePath: realTarget, stats };
}

/** Strict UTF-8 decode with a size cap and a binary check. */
export function decodeTextFile(buffer: Buffer, maxBytes: number): string {
  if (buffer.length > maxBytes) {
    throw new EditError('unsupported_file', 400, 'too_large');
  }

  if (buffer.includes(0)) {
    throw new EditError('unsupported_file', 400, 'binary');
  }

  const text = buffer.toString('utf8');

  if (!Buffer.from(text, 'utf8').equals(buffer)) {
    throw new EditError('unsupported_file', 400, 'invalid_utf8');
  }

  return text;
}

export function validateSnippet(
  input: unknown,
  field: 'find' | 'replace',
  allowEmpty: boolean,
): string {
  if (typeof input !== 'string') {
    throw new EditError('invalid_change', 400, field);
  }

  if (!allowEmpty && input.length === 0) {
    throw new EditError('invalid_change', 400, field);
  }

  if (Buffer.byteLength(input, 'utf8') > MAX_SNIPPET_BYTES) {
    throw new EditError('invalid_change', 400, `${field}_too_large`);
  }

  if (input.includes('\0')) {
    throw new EditError('invalid_change', 400, field);
  }

  if (Buffer.from(input, 'utf8').toString('utf8') !== input) {
    throw new EditError('invalid_change', 400, field);
  }

  return input;
}