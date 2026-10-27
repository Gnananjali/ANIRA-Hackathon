export type Risk = 'low' | 'medium' | 'high';

export type StepStatus = 'proposed';

export type StepKind = 'read' | 'write' | 'execute';

export type PlanActionType = 'read' | 'check' | 'edit' | 'report' | 'manual';

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  tool: string;
  risk: Risk;
  status: StepStatus;
  kind: StepKind;
  actionType: PlanActionType;
  dependsOn: string[];
  verification: string[];
  /** Source paths that justify this step, when one is available. */
  evidence?: string[];
}

export type FindingBasis = 'fact' | 'inference';

export interface PlanFinding {
  label: string;
  /** What was observed, in concrete terms. */
  detail: string;
  /** What the observation means, in simple language. */
  meaning: string;
  /** Source paths that support the finding. Always at least one. */
  evidence: string[];
  basis: FindingBasis;
}

export interface PlanConstraints {
  readOnly: boolean;
  forbidEdits: boolean;
  forbidExecution: boolean;
  destructive: boolean;
}

export interface InspectionSummary {
  name: string;
  root: string;
  totalFiles: number;
  truncated: boolean;
}

export interface PlanReport {
  brief: string;
  inspected: InspectionSummary | null;
  planner: 'ai' | 'deterministic';
  plannerReason?: string;
  plannerModel?: string;
  provider?: 'local' | 'external' | 'none';
  summary?: string;
  assumptions: string[];
  unknowns: string[];
  facts: PlanFinding[];
  inferences: PlanFinding[];
  /** Caveats that are not backed by a specific file. */
  limitations: string[];
  steps: PlanStep[];
  constraints: PlanConstraints;
  note: string;
}

export type ActivityKind = 'system' | 'user';

export interface ActivityEntry {
  id: string;
  at: string;
  kind: ActivityKind;
  message: string;
}

export interface HealthCapabilities {
  execution: boolean;
  llm: boolean;
  voice: boolean;
  desktopControl: boolean;
}

export interface HealthPayload {
  status: 'ok' | 'degraded';
  service: string;
  mode: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  capabilities: HealthCapabilities;
}

export interface HealthState {
  status: 'checking' | 'online' | 'offline';
  payload: HealthPayload | null;
  checkedAt: string | null;
}

export interface InspectionFile {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
}

export interface InspectionStackSignal {
  name: string;
  reason: string;
}

export interface InspectionLanguage {
  name: string;
  files: number;
}

export interface InspectionResult {
  root: string;
  name: string;
  files: InspectionFile[];
  totalFiles: number;
  totalBytes: number;
  truncated: boolean;
  ignored: string[];
  stack: InspectionStackSignal[];
  languages: InspectionLanguage[];
  scannedAt: string;
}

export interface CheckDefinition {
  id: string;
  label: string;
  command: string;
  description: string;
}

export interface CheckPreparation {
  approvalId: string;
  expiresAt: string;
  root: string;
  check: CheckDefinition;
}

export interface CheckRunResult {
  checkId: string;
  command: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export type LineEnding = 'LF' | 'CRLF' | 'CR' | 'mixed' | 'none';

export interface EditDiff {
  startLine: number;
  startColumn: number;
  removed: string[];
  added: string[];
  contextBefore: string[];
  contextAfter: string[];
  lineEnding: LineEnding;
}

export interface EditPreparation {
  editId: string;
  expiresAt: string;
  path: string;
  beforeHash: string;
  afterHash: string;
  diff: EditDiff;
}

export interface EditApplyResult {
  applied: true;
  path: string;
  beforeHash: string;
  afterHash: string;
  rollbackId: string;
  rollbackExpiresAt: string;
}

export interface EditRollbackResult {
  rolledBack: true;
  path: string;
  restoredHash: string;
  verifiedHash: true;
}

export type EvidenceType =
  | 'inspection'
  | 'planning'
  | 'approval'
  | 'edit'
  | 'verification'
  | 'recovery'
  | 'failure';

export type EvidenceOutcome =
  | 'planned'
  | 'approved'
  | 'executed'
  | 'verified'
  | 'failed'
  | 'blocked'
  | 'recovered';

export interface EvidenceInspection {
  kind: 'inspection';
  repoName: string;
  totalFiles: number;
  truncated: boolean;
  ignoredFolders: string[];
  stack: string[];
  languages: Array<{ name: string; files: number }>;
}

export interface EvidencePlanning {
  kind: 'planning';
  planner: 'ai' | 'deterministic';
  model?: string;
  fallbackReason?: string;
  stepCount: number;
  steps: Array<{ id: string; action: string; risk: string }>;
  inspected?: { totalFiles: number; truncated: boolean };
}

export interface EvidenceApproval {
  kind: 'approval';
  target: 'check' | 'edit' | 'rollback';
  checkId?: string;
  command?: string;
  path?: string;
}

export interface EvidenceEdit {
  kind: 'edit';
  path: string;
  beforeHash: string;
  afterHash: string;
}

export interface EvidenceVerification {
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

export interface EvidenceRecovery {
  kind: 'recovery';
  path: string;
  restoredHash?: string;
  afterHash?: string;
  verifiedHash?: boolean;
}

export interface EvidenceFailure {
  kind: 'failure';
  operation: string;
  reason: string;
}

interface EvidenceEventBase {
  id: string;
  at: string;
  sessionId: string;
  operation: string;
  reason?: string;
}

export type EvidenceEvent =
  | (EvidenceEventBase & {
      type: 'inspection';
      outcome: 'executed';
      evidence: EvidenceInspection;
    })
  | (EvidenceEventBase & {
      type: 'planning';
      outcome: 'planned';
      evidence: EvidencePlanning;
    })
  | (EvidenceEventBase & {
      type: 'approval';
      outcome: 'planned' | 'approved';
      evidence: EvidenceApproval;
    })
  | (EvidenceEventBase & {
      type: 'edit';
      outcome: 'planned' | 'executed' | 'failed' | 'blocked';
      evidence: EvidenceEdit;
    })
  | (EvidenceEventBase & {
      type: 'verification';
      outcome: 'verified' | 'failed';
      evidence: EvidenceVerification;
    })
  | (EvidenceEventBase & {
      type: 'recovery';
      outcome: 'recovered' | 'failed' | 'blocked';
      evidence: EvidenceRecovery;
    })
  | (EvidenceEventBase & {
      type: 'failure';
      outcome: 'failed' | 'blocked';
      evidence: EvidenceFailure;
    });

export interface EvidenceLimits {
  maxEventsPerSession: number;
  maxSessions: number;
  maxOutputBytes: number;
}

export interface EvidenceTimeline {
  sessionId: string;
  events: EvidenceEvent[];
  limits: EvidenceLimits;
  persistence: 'memory-only';
  note: string;
}