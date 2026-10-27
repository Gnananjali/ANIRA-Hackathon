import type { InspectionFile } from '../services/inspectRepository';
import type { PlanConstraints } from './constraints';

export type PlanRisk = 'low' | 'medium' | 'high';

export type PlannerAction =
  | { type: 'read'; path: string }
  | { type: 'check'; checkId: 'node-test' }
  | { type: 'edit'; path: string }
  | { type: 'report' }
  | { type: 'manual' };

export interface PlannedStep {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  risk: PlanRisk;
  action: PlannerAction;
  verification: string[];
  evidence: string[];
}

export interface ValidatedPlan {
  summary: string;
  steps: PlannedStep[];
  assumptions: string[];
  unknowns: string[];
}

export interface PlanValidationContext {
  paths: Map<string, string>;
  constraints: PlanConstraints;
  testScriptAvailable: boolean;
}

export type ValidationFailure = {
  ok: false;
  code: 'invalid_output' | 'unsafe_plan';
  detail: string;
};

export type ValidationResult =
  | { ok: true; plan: ValidatedPlan }
  | ValidationFailure;

const TOP_LEVEL_KEYS = ['summary', 'steps', 'assumptions', 'unknowns'] as const;
const STEP_KEYS = [
  'id',
  'title',
  'description',
  'dependsOn',
  'risk',
  'action',
  'verification',
  'evidence',
] as const;
const RISKS = new Set(['low', 'medium', 'high']);
const ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
const UNSAFE_INSTRUCTION =
  /\b(?:rm\s+-rf|del\s+\/[fsq]|format\s+[a-z]:|powershell(?:\.exe)?\s+-|cmd(?:\.exe)?\s+\/c|curl\b[\s\S]{0,80}\|\s*(?:sh|bash)|wget\b[\s\S]{0,80}\|\s*(?:sh|bash)|invoke-expression|iex\s*\(|eval\s*\()/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function invalid(detail: string): ValidationFailure {
  return { ok: false, code: 'invalid_output', detail };
}

function unsafe(detail: string): ValidationFailure {
  return { ok: false, code: 'unsafe_plan', detail };
}

function validText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !CONTROL_CHARS.test(value) &&
    !UNSAFE_INSTRUCTION.test(value)
  );
}

function validTextArray(
  value: unknown,
  min: number,
  max: number,
  itemMax: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every((item) => validText(item, itemMax))
  );
}

function canonicalPath(
  value: unknown,
  paths: Map<string, string>,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.length > 4096 || trimmed.includes('\0')) {
    return null;
  }

  const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/');

  if (
    normalized.startsWith('/') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return null;
  }

  return paths.get(normalized.toLowerCase()) ?? null;
}

function validateAction(
  raw: unknown,
  context: PlanValidationContext,
): { ok: true; action: PlannerAction } | ValidationFailure {
  if (!isRecord(raw)) {
    return invalid('action must be an object');
  }

  if (raw.type === 'read') {
    if (!hasOnlyKeys(raw, ['type', 'path'])) {
      return unsafe('read action has unknown fields');
    }
    const path = canonicalPath(raw.path, context.paths);
    if (!path) {
      return unsafe('read target is not in the scan');
    }
    return { ok: true, action: { type: 'read', path } };
  }

  if (raw.type === 'edit') {
    if (!hasOnlyKeys(raw, ['type', 'path'])) {
      return unsafe('edit action has unknown fields');
    }
    if (context.constraints.forbidEdits) {
      return unsafe('brief forbids edits');
    }
    const path = canonicalPath(raw.path, context.paths);
    if (!path) {
      return unsafe('edit target is not in the scan');
    }
    return { ok: true, action: { type: 'edit', path } };
  }

  if (raw.type === 'check') {
    if (!hasOnlyKeys(raw, ['type', 'checkId'])) {
      return unsafe('check action has unknown fields');
    }
    if (context.constraints.forbidExecution) {
      return unsafe('brief forbids execution');
    }
    if (!context.testScriptAvailable) {
      return unsafe('no test script is available');
    }
    if (raw.checkId !== 'node-test') {
      return unsafe('check id is not allowlisted');
    }
    return { ok: true, action: { type: 'check', checkId: 'node-test' } };
  }

  if (raw.type === 'report') {
    if (!hasOnlyKeys(raw, ['type'])) {
      return unsafe('report action has unknown fields');
    }
    return { ok: true, action: { type: 'report' } };
  }

  if (raw.type === 'manual') {
    if (!hasOnlyKeys(raw, ['type'])) {
      return unsafe('manual action has unknown fields');
    }
    return { ok: true, action: { type: 'manual' } };
  }

  return unsafe('action type is not allowlisted');
}

function validateStep(
  raw: unknown,
  context: PlanValidationContext,
): { ok: true; step: PlannedStep } | ValidationFailure {
  if (!isRecord(raw)) {
    return invalid('step must be an object');
  }

  if (!hasOnlyKeys(raw, STEP_KEYS)) {
    return invalid('step has unknown fields');
  }

  const id = raw.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    return invalid('step id is invalid');
  }

  const title = raw.title;
  if (!validText(title, 120)) {
    return unsafe(`step ${id} title is invalid or unsafe`);
  }

  const description = raw.description;
  if (!validText(description, 600)) {
    return unsafe(`step ${id} description is invalid or unsafe`);
  }

  const risk = raw.risk;
  if (typeof risk !== 'string' || !RISKS.has(risk)) {
    return invalid(`step ${id} risk is invalid`);
  }

  const verification = raw.verification;
  if (
    !Array.isArray(verification) ||
    verification.length < 1 ||
    verification.length > 4 ||
    verification.some((item) => typeof item !== 'string')
  ) {
    return invalid(`step ${id} verification is invalid`);
  }
  if (!validTextArray(verification, 1, 4, 200)) {
    return unsafe(`step ${id} verification is invalid or unsafe`);
  }

  const dependsOn = raw.dependsOn;
  if (!Array.isArray(dependsOn) || dependsOn.length > 8) {
    return invalid(`step ${id} dependsOn is invalid`);
  }

  if (dependsOn.some((dependency) => typeof dependency !== 'string')) {
    return invalid(`step ${id} dependsOn is invalid`);
  }

  const rawEvidence = raw.evidence;
  if (!Array.isArray(rawEvidence) || rawEvidence.length > 8) {
    return invalid(`step ${id} evidence is invalid`);
  }

  const actionResult = validateAction(raw.action, context);
  if (!actionResult.ok) {
    return actionResult;
  }

  const evidence: string[] = [];
  for (const item of rawEvidence) {
    const path = canonicalPath(item, context.paths);
    if (!path) {
      return unsafe(`step ${id} evidence is not in the scan`);
    }
    if (!evidence.includes(path)) {
      evidence.push(path);
    }
  }

  const needsEvidence =
    actionResult.action.type === 'read' ||
    actionResult.action.type === 'edit' ||
    actionResult.action.type === 'check';

  if (needsEvidence && evidence.length === 0) {
    return unsafe(`step ${id} has no evidence`);
  }

  return {
    ok: true,
    step: {
      id,
      title,
      description,
      dependsOn: [...(dependsOn as string[])],
      risk: risk as PlanRisk,
      action: actionResult.action,
      verification: [...verification],
      evidence,
    },
  };
}

function topologicalOrder(steps: PlannedStep[]): PlannedStep[] | null {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: PlannedStep[] = [];

  function visit(id: string): boolean {
    if (visited.has(id)) {
      return true;
    }
    if (visiting.has(id)) {
      return false;
    }

    const step = byId.get(id);
    if (!step) {
      return false;
    }

    visiting.add(id);
    for (const dependency of step.dependsOn) {
      if (!visit(dependency)) {
        return false;
      }
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(step);
    return true;
  }

  for (const step of steps) {
    if (!visit(step.id)) {
      return null;
    }
  }

  return ordered;
}

/**
 * Strictly validates model output. Closed objects, allowlisted actions,
 * evidence paths from the scan, unique ids, acyclic dependencies, and
 * constraint-aware action permissions.
 */
export function validatePlan(
  raw: unknown,
  context: PlanValidationContext,
): ValidationResult {
  if (!isRecord(raw)) {
    return invalid('plan must be an object');
  }

  if (!hasOnlyKeys(raw, TOP_LEVEL_KEYS)) {
    return invalid('plan has unknown fields');
  }

  const summary = raw.summary;
  if (!validText(summary, 600)) {
    return unsafe('summary is invalid or unsafe');
  }

  const rawSteps = raw.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length < 1 || rawSteps.length > 10) {
    return invalid('plan must have 1-10 steps');
  }

  const assumptions = raw.assumptions;
  if (!validTextArray(assumptions, 0, 10, 300)) {
    return unsafe('assumptions are invalid or unsafe');
  }

  const unknowns = raw.unknowns;
  if (!validTextArray(unknowns, 0, 10, 300)) {
    return unsafe('unknowns are invalid or unsafe');
  }

  const steps: PlannedStep[] = [];
  const ids = new Set<string>();

  for (const rawStep of rawSteps) {
    const result = validateStep(rawStep, context);
    if (!result.ok) {
      return result;
    }

    if (ids.has(result.step.id)) {
      return invalid(`duplicate step id: ${result.step.id}`);
    }

    ids.add(result.step.id);
    steps.push(result.step);
  }

  for (const step of steps) {
    if (new Set(step.dependsOn).size !== step.dependsOn.length) {
      return invalid(`step ${step.id} has duplicate dependencies`);
    }

    for (const dependency of step.dependsOn) {
      if (dependency === step.id) {
        return invalid(`step ${step.id} depends on itself`);
      }
      if (!ids.has(dependency)) {
        return invalid(`step ${step.id} depends on unknown id ${dependency}`);
      }
    }
  }

  const ordered = topologicalOrder(steps);
  if (!ordered) {
    return invalid('dependencies contain a cycle');
  }

  return {
    ok: true,
    plan: {
      summary,
      steps: ordered,
      assumptions: [...assumptions],
      unknowns: [...unknowns],
    },
  };
}

export function buildPathIndex(files: InspectionFile[]): Map<string, string> {
  const paths = new Map<string, string>();
  for (const file of files) {
    paths.set(file.path.toLowerCase(), file.path);
  }
  return paths;
}