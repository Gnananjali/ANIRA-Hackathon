export type Risk = 'low' | 'medium' | 'high';

export type StepStatus = 'proposed';

export type StepKind = 'read' | 'write' | 'execute';

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  tool: string;
  risk: Risk;
  status: StepStatus;
  kind: StepKind;
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
  facts: PlanFinding[];
  inferences: PlanFinding[];
  /** Caveats that are not backed by a specific file. */
  limitations: string[];
  steps: PlanStep[];
  constraints: PlanConstraints;
  note: string;
}

export type ActivityKind = 'system' | 'user' | 'demo';

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