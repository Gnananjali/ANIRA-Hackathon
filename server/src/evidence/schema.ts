export const EVIDENCE_TYPES = [
  'inspection',
  'planning',
  'approval',
  'edit',
  'verification',
  'recovery',
  'failure',
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_OUTCOMES = [
  'planned',
  'approved',
  'executed',
  'verified',
  'failed',
  'blocked',
  'recovered',
] as const;

export type EvidenceOutcome = (typeof EVIDENCE_OUTCOMES)[number];

export const EVIDENCE_SESSION_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const EVIDENCE_SESSION_FALLBACK = 'anonymous';

export const EVIDENCE_NOTE =
  'In-memory evidence for this server process only. Events are lost on restart and are not tamper-proof or durable audit storage.';

export const EVIDENCE_LIMITS = {
  maxEventsPerSession: 100,
  maxSessions: 32,
  maxOutputBytes: 4 * 1024,
} as const;

export interface EvidenceLimits {
  maxEventsPerSession: number;
  maxSessions: number;
  maxOutputBytes: number;
}

export interface InspectionEvidence {
  kind: 'inspection';
  repoName: string;
  totalFiles: number;
  truncated: boolean;
  ignoredFolders: string[];
  stack: string[];
  languages: Array<{ name: string; files: number }>;
}

export interface PlanningStepEvidence {
  id: string;
  action: string;
  risk: string;
}

export interface PlanningEvidence {
  kind: 'planning';
  planner: 'ai' | 'deterministic';
  model?: string;
  fallbackReason?: string;
  stepCount: number;
  steps: PlanningStepEvidence[];
  inspected?: { totalFiles: number; truncated: boolean };
}

export interface ApprovalEvidence {
  kind: 'approval';
  target: 'check' | 'edit' | 'rollback';
  checkId?: string;
  command?: string;
  path?: string;
}

export interface EditEvidence {
  kind: 'edit';
  path: string;
  beforeHash: string;
  afterHash: string;
}

export interface VerificationEvidence {
  kind: 'verification';
  checkId: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  truncated: boolean;
  stdout: string;
  stderr: string;
  coversPlanSteps: false;
}

export interface RecoveryEvidence {
  kind: 'recovery';
  path: string;
  restoredHash?: string;
  afterHash?: string;
  verifiedHash?: boolean;
}

export interface FailureEvidence {
  kind: 'failure';
  operation: string;
  reason: string;
}

export type EvidencePayload =
  | InspectionEvidence
  | PlanningEvidence
  | ApprovalEvidence
  | EditEvidence
  | VerificationEvidence
  | RecoveryEvidence
  | FailureEvidence;

interface EvidenceInputBase {
  operation: string;
  reason?: string;
}

export type EvidenceInput =
  | (EvidenceInputBase & {
      type: 'inspection';
      outcome: 'executed';
      evidence: InspectionEvidence;
    })
  | (EvidenceInputBase & {
      type: 'planning';
      outcome: 'planned';
      evidence: PlanningEvidence;
    })
  | (EvidenceInputBase & {
      type: 'approval';
      outcome: 'planned' | 'approved';
      evidence: ApprovalEvidence;
    })
  | (EvidenceInputBase & {
      type: 'edit';
      outcome: 'planned' | 'executed' | 'failed' | 'blocked';
      evidence: EditEvidence;
    })
  | (EvidenceInputBase & {
      type: 'verification';
      outcome: 'verified' | 'failed';
      evidence: VerificationEvidence;
    })
  | (EvidenceInputBase & {
      type: 'recovery';
      outcome: 'recovered' | 'failed' | 'blocked';
      evidence: RecoveryEvidence;
    })
  | (EvidenceInputBase & {
      type: 'failure';
      outcome: 'failed' | 'blocked';
      evidence: FailureEvidence;
    });

export type EvidenceEvent = EvidenceInput & {
  id: string;
  at: string;
  sessionId: string;
};

export interface EvidenceRecorder {
  append(sessionId: string, input: EvidenceInput): EvidenceEvent;
}

export class EvidenceError extends Error {
  constructor(
    public readonly code:
      | 'invalid_session'
      | 'invalid_event'
      | 'missing_evidence'
      | 'invalid_outcome',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'EvidenceError';
  }
}