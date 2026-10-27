import { randomUUID } from 'node:crypto';

import {
  EVIDENCE_LIMITS,
  EVIDENCE_NOTE,
  EVIDENCE_OUTCOMES,
  EVIDENCE_SESSION_PATTERN,
  EVIDENCE_TYPES,
  EvidenceError,
  type EvidenceEvent,
  type EvidenceInput,
  type EvidenceLimits,
  type EvidenceRecorder,
} from './schema';
import { environmentSecretValues, sanitizeEvidenceInput } from './sanitize';

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RISKS = new Set(['low', 'medium', 'high']);
const ACTIONS = new Set(['read', 'check', 'edit', 'report', 'manual']);

type InspectionInput = Extract<EvidenceInput, { type: 'inspection' }>;
type PlanningInput = Extract<EvidenceInput, { type: 'planning' }>;
type ApprovalInput = Extract<EvidenceInput, { type: 'approval' }>;
type EditInput = Extract<EvidenceInput, { type: 'edit' }>;
type VerificationInput = Extract<EvidenceInput, { type: 'verification' }>;
type RecoveryInput = Extract<EvidenceInput, { type: 'recovery' }>;
type FailureInput = Extract<EvidenceInput, { type: 'failure' }>;

export interface EvidenceStoreOptions {
  now?: () => number;
  maxEventsPerSession?: number;
  maxSessions?: number;
  maxOutputBytes?: number;
  secrets?: string[];
  id?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireText(
  value: unknown,
  max: number,
  field: string,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new EvidenceError('missing_evidence', field);
  }

  return value;
}

function requireHash(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new EvidenceError('missing_evidence', field);
  }

  return value;
}

function validateInspection(input: InspectionInput): void {
  if (input.outcome !== 'executed') {
    throw new EvidenceError('invalid_outcome');
  }

  const evidence = input.evidence;
  requireText(evidence.repoName, 200, 'repoName');

  if (
    !Number.isInteger(evidence.totalFiles) ||
    evidence.totalFiles < 0 ||
    evidence.totalFiles > 1_000_000 ||
    typeof evidence.truncated !== 'boolean' ||
    !Array.isArray(evidence.ignoredFolders) ||
    evidence.ignoredFolders.length > 8 ||
    !evidence.ignoredFolders.every((folder) => typeof folder === 'string') ||
    !Array.isArray(evidence.stack) ||
    evidence.stack.length > 12 ||
    !evidence.stack.every((signal) => typeof signal === 'string') ||
    !Array.isArray(evidence.languages) ||
    evidence.languages.length > 6 ||
    !evidence.languages.every(
      (language) =>
        typeof language.name === 'string' &&
        Number.isInteger(language.files) &&
        language.files >= 0,
    )
  ) {
    throw new EvidenceError('missing_evidence', 'inspection');
  }
}

function validatePlanning(input: PlanningInput): void {
  if (input.outcome !== 'planned') {
    throw new EvidenceError('invalid_outcome');
  }

  const evidence = input.evidence;
  if (
    (evidence.planner !== 'ai' && evidence.planner !== 'deterministic') ||
    !Number.isInteger(evidence.stepCount) ||
    evidence.stepCount < 0 ||
    evidence.stepCount > 10 ||
    !Array.isArray(evidence.steps) ||
    evidence.steps.length > 10 ||
    !evidence.steps.every(
      (step) =>
        typeof step.id === 'string' &&
        step.id.length > 0 &&
        step.id.length <= 64 &&
        ACTIONS.has(step.action) &&
        RISKS.has(step.risk),
    ) ||
    (evidence.model !== undefined &&
      (typeof evidence.model !== 'string' || evidence.model.length > 128)) ||
    (evidence.fallbackReason !== undefined &&
      (typeof evidence.fallbackReason !== 'string' ||
        evidence.fallbackReason.length > 80)) ||
    (evidence.inspected !== undefined &&
      (!isRecord(evidence.inspected) ||
        !Number.isInteger(evidence.inspected.totalFiles) ||
        typeof evidence.inspected.truncated !== 'boolean'))
  ) {
    throw new EvidenceError('missing_evidence', 'planning');
  }
}

function validateApproval(input: ApprovalInput): void {
  if (input.outcome !== 'planned' && input.outcome !== 'approved') {
    throw new EvidenceError('invalid_outcome');
  }

  const evidence = input.evidence;
  if (!['check', 'edit', 'rollback'].includes(evidence.target)) {
    throw new EvidenceError('missing_evidence', 'target');
  }

  if (evidence.target === 'check') {
    requireText(evidence.checkId, 64, 'checkId');
    requireText(evidence.command, 120, 'command');
  } else {
    requireText(evidence.path, 512, 'path');
  }
}

function validateEdit(input: EditInput): void {
  if (
    input.outcome !== 'planned' &&
    input.outcome !== 'executed' &&
    input.outcome !== 'failed' &&
    input.outcome !== 'blocked'
  ) {
    throw new EvidenceError('invalid_outcome');
  }

  requireText(input.evidence.path, 512, 'path');
  requireHash(input.evidence.beforeHash, 'beforeHash');
  requireHash(input.evidence.afterHash, 'afterHash');
}

function validateVerification(input: VerificationInput): void {
  if (input.outcome !== 'verified' && input.outcome !== 'failed') {
    throw new EvidenceError('invalid_outcome');
  }

  const evidence = input.evidence;
  requireText(evidence.checkId, 64, 'checkId');
  requireText(evidence.command, 120, 'command');

  if (
    (evidence.exitCode !== null &&
      (!Number.isInteger(evidence.exitCode) ||
        evidence.exitCode < -1 ||
        evidence.exitCode > 255)) ||
    typeof evidence.timedOut !== 'boolean' ||
    !Number.isFinite(evidence.durationMs) ||
    evidence.durationMs < 0 ||
    typeof evidence.truncated !== 'boolean' ||
    typeof evidence.stdout !== 'string' ||
    typeof evidence.stderr !== 'string' ||
    evidence.coversPlanSteps !== false
  ) {
    throw new EvidenceError('missing_evidence', 'verification');
  }

  const succeeded = evidence.exitCode === 0 && !evidence.timedOut;

  if (input.outcome === 'verified' && !succeeded) {
    throw new EvidenceError('invalid_outcome', 'verified requires exit 0');
  }

  if (input.outcome === 'failed' && succeeded) {
    throw new EvidenceError('invalid_outcome', 'failed cannot be a clean exit');
  }
}

function validateRecovery(input: RecoveryInput): void {
  if (
    input.outcome !== 'recovered' &&
    input.outcome !== 'failed' &&
    input.outcome !== 'blocked'
  ) {
    throw new EvidenceError('invalid_outcome');
  }

  requireText(input.evidence.path, 512, 'path');

  if (input.outcome === 'recovered') {
    requireHash(input.evidence.restoredHash, 'restoredHash');
    if (input.evidence.verifiedHash !== true) {
      throw new EvidenceError('missing_evidence', 'verifiedHash');
    }
  } else if (
    input.evidence.restoredHash !== undefined &&
    (typeof input.evidence.restoredHash !== 'string' ||
      !HASH_PATTERN.test(input.evidence.restoredHash))
  ) {
    throw new EvidenceError('missing_evidence', 'restoredHash');
  }

  if (input.outcome !== 'recovered' && input.evidence.verifiedHash === true) {
    throw new EvidenceError(
      'invalid_outcome',
      'failed recovery cannot be verified',
    );
  }

  if (
    input.evidence.verifiedHash !== undefined &&
    typeof input.evidence.verifiedHash !== 'boolean'
  ) {
    throw new EvidenceError('missing_evidence', 'verifiedHash');
  }

  if (
    input.evidence.afterHash !== undefined &&
    (typeof input.evidence.afterHash !== 'string' ||
      !HASH_PATTERN.test(input.evidence.afterHash))
  ) {
    throw new EvidenceError('missing_evidence', 'afterHash');
  }
}

function validateFailure(input: FailureInput): void {
  if (input.outcome !== 'failed' && input.outcome !== 'blocked') {
    throw new EvidenceError('invalid_outcome');
  }

  requireText(input.reason, 120, 'reason');
  requireText(input.evidence.operation, 120, 'operation');
  requireText(input.evidence.reason, 120, 'reason');
}

export function validateEvidenceInput(input: EvidenceInput): void {
  if (
    !isRecord(input) ||
    typeof input.type !== 'string' ||
    !(EVIDENCE_TYPES as readonly string[]).includes(input.type) ||
    typeof input.outcome !== 'string' ||
    !(EVIDENCE_OUTCOMES as readonly string[]).includes(input.outcome) ||
    typeof input.operation !== 'string' ||
    input.operation.length === 0 ||
    input.operation.length > 120 ||
    (input.reason !== undefined &&
      (typeof input.reason !== 'string' || input.reason.length > 120)) ||
    !isRecord(input.evidence) ||
    input.evidence.kind !== input.type
  ) {
    throw new EvidenceError('invalid_event');
  }

  if (
    (input.outcome === 'failed' || input.outcome === 'blocked') &&
    (typeof input.reason !== 'string' || input.reason.length === 0)
  ) {
    throw new EvidenceError('missing_evidence', 'reason');
  }

  switch (input.type) {
    case 'inspection':
      validateInspection(input);
      return;
    case 'planning':
      validatePlanning(input);
      return;
    case 'approval':
      validateApproval(input);
      return;
    case 'edit':
      validateEdit(input);
      return;
    case 'verification':
      validateVerification(input);
      return;
    case 'recovery':
      validateRecovery(input);
      return;
    case 'failure':
      validateFailure(input);
      return;
    default:
      throw new EvidenceError('invalid_event');
  }
}

export function createEvidenceStore(options: EvidenceStoreOptions = {}) {
  const now = options.now ?? Date.now;
  const createId = options.id ?? randomUUID;
  const limits: EvidenceLimits = {
    maxEventsPerSession:
      options.maxEventsPerSession ?? EVIDENCE_LIMITS.maxEventsPerSession,
    maxSessions: options.maxSessions ?? EVIDENCE_LIMITS.maxSessions,
    maxOutputBytes: options.maxOutputBytes ?? EVIDENCE_LIMITS.maxOutputBytes,
  };
  const secrets = [
    ...new Set([...(options.secrets ?? []), ...environmentSecretValues()]),
  ];
  const sessions = new Map<string, EvidenceEvent[]>();

  return {
    limits,
    note: EVIDENCE_NOTE,

    append(sessionId: string, input: EvidenceInput): EvidenceEvent {
      if (
        typeof sessionId !== 'string' ||
        !EVIDENCE_SESSION_PATTERN.test(sessionId)
      ) {
        throw new EvidenceError('invalid_session');
      }

      validateEvidenceInput(input);

      const sanitized = sanitizeEvidenceInput(input, {
        maxOutputBytes: limits.maxOutputBytes,
        secrets,
      });
      validateEvidenceInput(sanitized);

      const event = {
        ...sanitized,
        id: createId(),
        at: new Date(now()).toISOString(),
        sessionId,
      } as EvidenceEvent;

      let events = sessions.get(sessionId);

      if (!events) {
        if (sessions.size >= limits.maxSessions) {
          const oldest = sessions.keys().next().value;
          if (oldest) {
            sessions.delete(oldest);
          }
        }

        events = [];
        sessions.set(sessionId, events);
      }

      events.push(event);

      if (events.length > limits.maxEventsPerSession) {
        events.splice(0, events.length - limits.maxEventsPerSession);
      }

      return structuredClone(event);
    },

    list(sessionId: string): EvidenceEvent[] {
      if (
        typeof sessionId !== 'string' ||
        !EVIDENCE_SESSION_PATTERN.test(sessionId)
      ) {
        return [];
      }

      return structuredClone(sessions.get(sessionId) ?? []);
    },
  };
}

export type EvidenceStore = ReturnType<typeof createEvidenceStore> & EvidenceRecorder;