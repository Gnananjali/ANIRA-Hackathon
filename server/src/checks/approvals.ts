import { randomUUID } from 'node:crypto';

export interface Approval {
  id: string;
  root: string;
  checkId: string;
  command: string;
  expiresAt: number;
}

export type ConsumeResult =
  | { ok: true; approval: Approval }
  | { ok: false; reason: 'invalid' | 'expired' };

export function createApprovalStore(
  ttlMs: number,
  now: () => number = Date.now,
) {
  const pending = new Map<string, Approval>();

  function prune(): void {
    const current = now();
    for (const [id, approval] of pending) {
      if (approval.expiresAt <= current) {
        pending.delete(id);
      }
    }
  }

  return {
    create(root: string, checkId: string, command: string): Approval {
      prune();

      const approval: Approval = {
        id: randomUUID(),
        root,
        checkId,
        command,
        expiresAt: now() + ttlMs,
      };

      pending.set(approval.id, approval);
      return approval;
    },

    /**
     * Consumes an approval exactly once. Expired approvals are deleted before
     * reporting expiry, so a late retry cannot succeed.
     */
    consume(input: unknown): ConsumeResult {
      if (typeof input !== 'string' || input.length === 0) {
        return { ok: false, reason: 'invalid' };
      }

      const approval = pending.get(input);
      if (!approval) {
        return { ok: false, reason: 'invalid' };
      }

      pending.delete(input);

      if (approval.expiresAt <= now()) {
        return { ok: false, reason: 'expired' };
      }

      return { ok: true, approval };
    },

    size(): number {
      return pending.size;
    },
  };
}