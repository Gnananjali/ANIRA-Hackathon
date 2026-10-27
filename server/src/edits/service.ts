import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { EditDiff } from './preview';
import { buildEditDiff } from './preview';
import {
  decodeTextFile,
  EditError,
  MAX_FILE_BYTES_DEFAULT,
  normalizeRelativePath,
  resolveEditRoot,
  resolveEditTarget,
  samePath,
  sha256,
  validateSnippet,
} from './path';
import { writeFileAtomic } from './writer';
import { failureInput, recordEvidence } from '../evidence/recorder';
import type { EvidenceRecorder } from '../evidence/schema';

export interface PrepareEditResult {
  editId: string;
  expiresAt: string;
  path: string;
  beforeHash: string;
  afterHash: string;
  diff: EditDiff;
}

export interface ApplyEditResult {
  applied: true;
  path: string;
  beforeHash: string;
  afterHash: string;
  rollbackId: string;
  rollbackExpiresAt: string;
}

export interface RollbackEditResult {
  rolledBack: true;
  path: string;
  restoredHash: string;
  verifiedHash: true;
}

export interface EditServiceOptions {
  approvalTtlMs?: number;
  rollbackTtlMs?: number;
  maxFileBytes?: number;
  now?: () => number;
  writer?: (target: string, data: Buffer) => Promise<void>;
  evidence?: EvidenceRecorder;
}

interface PendingEdit {
  id: string;
  root: string;
  relativePath: string;
  absolutePath: string;
  operation: 'replace-once';
  beforeHash: string;
  afterHash: string;
  beforeBuffer: Buffer;
  afterBuffer: Buffer;
  expiresAt: number;
}

interface RollbackRecord {
  id: string;
  root: string;
  relativePath: string;
  absolutePath: string;
  beforeBuffer: Buffer;
  beforeHash: string;
  afterHash: string;
  expiresAt: number;
}

interface StoredItem {
  id: string;
  expiresAt: number;
}

function createStore<T extends StoredItem>(now: () => number) {
  const items = new Map<string, T>();

  return {
    set(item: T): void {
      const current = now();
      for (const [id, value] of items) {
        if (value.expiresAt <= current) {
          items.delete(id);
        }
      }
      items.set(item.id, item);
    },

    consume(
      id: unknown,
    ): { ok: true; item: T } | { ok: false; reason: 'invalid' | 'expired' } {
      if (typeof id !== 'string' || id.length === 0) {
        return { ok: false, reason: 'invalid' };
      }

      const item = items.get(id);
      if (!item) {
        return { ok: false, reason: 'invalid' };
      }

      items.delete(id);

      if (item.expiresAt <= now()) {
        return { ok: false, reason: 'expired' };
      }

      return { ok: true, item };
    },
  };
}

function displayPath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function editPrepareOutcome(code: string): 'failed' | 'blocked' {
  return ['invalid_path', 'unsafe_path', 'ignored_path', 'path_changed'].includes(
    code,
  )
    ? 'blocked'
    : 'failed';
}

function editWriteOutcome(code: string): 'failed' | 'blocked' {
  return code === 'write_failed' || code === 'rollback_verification_failed'
    ? 'failed'
    : 'blocked';
}

export function createEditService(options: EditServiceOptions = {}) {
  const now = options.now ?? Date.now;
  const approvalTtlMs = options.approvalTtlMs ?? 120_000;
  const rollbackTtlMs = options.rollbackTtlMs ?? 600_000;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES_DEFAULT;
  const writer = options.writer ?? writeFileAtomic;
  const evidence = options.evidence;

  const pending = createStore<PendingEdit>(now);
  const rollbacks = createStore<RollbackRecord>(now);
  let active = false;

  return {
    async prepare(input: {
      root: unknown;
      path: unknown;
      find: unknown;
      replace: unknown;
      sessionId?: string;
    }): Promise<PrepareEditResult> {
      const sessionId = input.sessionId ?? 'anonymous';

      try {
        const root = await resolveEditRoot(input.root);
        const relativePath = normalizeRelativePath(input.path);
        const find = validateSnippet(input.find, 'find', false);
        const replace = validateSnippet(input.replace, 'replace', true);

        const target = await resolveEditTarget(root, relativePath);
        const beforeBuffer = await fs.readFile(target.absolutePath);
        const before = decodeTextFile(beforeBuffer, maxFileBytes);

        const index = before.indexOf(find);
        if (index === -1) {
          throw new EditError('no_match', 400);
        }
        if (before.indexOf(find, index + 1) !== -1) {
          throw new EditError('ambiguous_change', 400, 'multiple_matches');
        }
        if (find === replace) {
          throw new EditError('no_change', 400);
        }

        const after = before.slice(0, index) + replace + before.slice(index + find.length);

        if (Buffer.from(after, 'utf8').toString('utf8') !== after) {
          throw new EditError('invalid_change', 400, 'replacement');
        }

        const afterBuffer = Buffer.from(after, 'utf8');
        const beforeHash = sha256(beforeBuffer);
        const afterHash = sha256(afterBuffer);
        const expiresAt = now() + approvalTtlMs;
        const id = randomUUID();

        pending.set({
          id,
          root,
          relativePath,
          absolutePath: target.absolutePath,
          operation: 'replace-once',
          beforeHash,
          afterHash,
          beforeBuffer,
          afterBuffer,
          expiresAt,
        });

        recordEvidence(evidence, sessionId, {
          type: 'edit',
          outcome: 'planned',
          operation: 'edits.prepare',
          evidence: {
            kind: 'edit',
            path: displayPath(relativePath),
            beforeHash,
            afterHash,
          },
        });

        return {
          editId: id,
          expiresAt: new Date(expiresAt).toISOString(),
          path: displayPath(relativePath),
          beforeHash,
          afterHash,
          diff: buildEditDiff(before, after, find, replace, index),
        };
      } catch (error) {
        if (error instanceof EditError) {
          recordEvidence(
            evidence,
            sessionId,
            failureInput(
              'edits.prepare',
              editPrepareOutcome(error.code),
              error.reason ?? error.code,
            ),
          );
        }

        throw error;
      }
    },

    async apply(
      editId: unknown,
      sessionId = 'anonymous',
    ): Promise<ApplyEditResult> {
      if (active) {
        recordEvidence(
          evidence,
          sessionId,
          failureInput('edits.apply', 'blocked', 'edit_in_progress'),
        );
        throw new EditError('edit_in_progress', 409);
      }

      const consumed = pending.consume(editId);
      if (!consumed.ok) {
        const reason =
          consumed.reason === 'expired' ? 'approval_expired' : 'approval_invalid';
        recordEvidence(
          evidence,
          sessionId,
          failureInput('edits.apply', 'blocked', reason),
        );
        throw consumed.reason === 'expired'
          ? new EditError('approval_expired', 410)
          : new EditError('approval_invalid', 400);
      }

      const edit = consumed.item;
      if (edit.operation !== 'replace-once') {
        recordEvidence(
          evidence,
          sessionId,
          failureInput('edits.apply', 'blocked', 'approval_invalid'),
        );
        throw new EditError('approval_invalid', 400);
      }

      active = true;

      recordEvidence(evidence, sessionId, {
        type: 'approval',
        outcome: 'approved',
        operation: 'edits.apply',
        evidence: {
          kind: 'approval',
          target: 'edit',
          path: displayPath(edit.relativePath),
        },
      });

      let applied = false;

      try {
        const target = await resolveEditTarget(edit.root, edit.relativePath);

        if (!samePath(target.absolutePath, edit.absolutePath)) {
          throw new EditError('file_changed', 409, 'path_changed');
        }

        const current = await fs.readFile(target.absolutePath);
        if (sha256(current) !== edit.beforeHash) {
          throw new EditError('file_changed', 409);
        }

        try {
          await writer(target.absolutePath, edit.afterBuffer);
        } catch {
          throw new EditError('write_failed', 500);
        }

        applied = true;

        recordEvidence(evidence, sessionId, {
          type: 'edit',
          outcome: 'executed',
          operation: 'edits.apply',
          evidence: {
            kind: 'edit',
            path: displayPath(edit.relativePath),
            beforeHash: edit.beforeHash,
            afterHash: edit.afterHash,
          },
        });

        const rollbackId = randomUUID();
        const expiresAt = now() + rollbackTtlMs;

        rollbacks.set({
          id: rollbackId,
          root: edit.root,
          relativePath: edit.relativePath,
          absolutePath: edit.absolutePath,
          beforeBuffer: edit.beforeBuffer,
          beforeHash: edit.beforeHash,
          afterHash: edit.afterHash,
          expiresAt,
        });

        return {
          applied: true,
          path: displayPath(edit.relativePath),
          beforeHash: edit.beforeHash,
          afterHash: edit.afterHash,
          rollbackId,
          rollbackExpiresAt: new Date(expiresAt).toISOString(),
        };
      } catch (error) {
        if (!applied) {
          const reason =
            error instanceof EditError
              ? error.reason ?? error.code
              : 'edit_failed';

          recordEvidence(evidence, sessionId, {
            type: 'edit',
            outcome:
              error instanceof EditError
                ? editWriteOutcome(error.code)
                : 'failed',
            operation: 'edits.apply',
            reason,
            evidence: {
              kind: 'edit',
              path: displayPath(edit.relativePath),
              beforeHash: edit.beforeHash,
              afterHash: edit.afterHash,
            },
          });
        }

        throw error;
      } finally {
        active = false;
      }
    },

    async rollback(
      rollbackId: unknown,
      sessionId = 'anonymous',
    ): Promise<RollbackEditResult> {
      if (active) {
        recordEvidence(
          evidence,
          sessionId,
          failureInput('edits.rollback', 'blocked', 'edit_in_progress'),
        );
        throw new EditError('edit_in_progress', 409);
      }

      const consumed = rollbacks.consume(rollbackId);
      if (!consumed.ok) {
        const reason =
          consumed.reason === 'expired' ? 'rollback_expired' : 'rollback_invalid';
        recordEvidence(
          evidence,
          sessionId,
          failureInput('edits.rollback', 'blocked', reason),
        );
        throw consumed.reason === 'expired'
          ? new EditError('rollback_expired', 410)
          : new EditError('rollback_invalid', 400);
      }

      const record = consumed.item;
      active = true;

      recordEvidence(evidence, sessionId, {
        type: 'approval',
        outcome: 'approved',
        operation: 'edits.rollback',
        evidence: {
          kind: 'approval',
          target: 'rollback',
          path: displayPath(record.relativePath),
        },
      });

      let verified = false;

      try {
        const target = await resolveEditTarget(record.root, record.relativePath);

        if (!samePath(target.absolutePath, record.absolutePath)) {
          throw new EditError('file_changed', 409, 'path_changed');
        }

        const current = await fs.readFile(target.absolutePath);
        if (sha256(current) !== record.afterHash) {
          throw new EditError('file_changed', 409);
        }

        try {
          await writer(target.absolutePath, record.beforeBuffer);
        } catch {
          throw new EditError('write_failed', 500);
        }

        let restored: Buffer;
        try {
          restored = await fs.readFile(target.absolutePath);
        } catch {
          throw new EditError(
            'rollback_verification_failed',
            500,
            'read_failed',
          );
        }

        if (sha256(restored) !== record.beforeHash) {
          throw new EditError(
            'rollback_verification_failed',
            500,
            'hash_mismatch',
          );
        }

        verified = true;

        recordEvidence(evidence, sessionId, {
          type: 'recovery',
          outcome: 'recovered',
          operation: 'edits.rollback',
          evidence: {
            kind: 'recovery',
            path: displayPath(record.relativePath),
            restoredHash: record.beforeHash,
            afterHash: record.afterHash,
            verifiedHash: true,
          },
        });

        return {
          rolledBack: true,
          path: displayPath(record.relativePath),
          restoredHash: record.beforeHash,
          verifiedHash: true,
        };
      } catch (error) {
        if (!verified) {
          const reason =
            error instanceof EditError
              ? error.reason ?? error.code
              : 'rollback_failed';

          recordEvidence(evidence, sessionId, {
            type: 'recovery',
            outcome:
              error instanceof EditError
                ? editWriteOutcome(error.code)
                : 'failed',
            operation: 'edits.rollback',
            reason,
            evidence: {
              kind: 'recovery',
              path: displayPath(record.relativePath),
              afterHash: record.afterHash,
              verifiedHash: false,
            },
          });
        }

        throw error;
      } finally {
        active = false;
      }
    },
  };
}

export type EditService = ReturnType<typeof createEditService>;