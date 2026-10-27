import type { EvidenceInput, EvidenceRecorder } from './schema';

/**
 * Evidence must never break the operation it is describing. If a recorder is
 * absent or rejects malformed evidence, the operation proceeds without proof.
 */
export function recordEvidence(
  recorder: EvidenceRecorder | undefined,
  sessionId: string | undefined,
  input: EvidenceInput,
): void {
  if (!recorder) {
    return;
  }

  try {
    recorder.append(sessionId || 'anonymous', input);
  } catch {
    // A missing proof event is safer than a fabricated one or a failed action.
  }
}

export function failureInput(
  operation: string,
  outcome: 'failed' | 'blocked',
  reason: string,
): EvidenceInput {
  return {
    type: 'failure',
    outcome,
    operation,
    reason,
    evidence: {
      kind: 'failure',
      operation,
      reason,
    },
  };
}