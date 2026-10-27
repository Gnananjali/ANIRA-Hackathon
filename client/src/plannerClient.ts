import { evidenceHeaders } from './evidenceSession';

export type PlannerProvider = 'local' | 'external' | 'none';
export interface PlannerConfig {
  available: boolean;
  provider: PlannerProvider;
  model?: string;
}

export type AiActionType = 'read' | 'check' | 'edit' | 'report' | 'manual';

export interface AiAction {
  type: AiActionType;
  path?: string;
  checkId?: string;
}

export interface AiPlanStep {
  id: string;
  title: string;
  description: string;
  dependsOn: string[];
  risk: 'low' | 'medium' | 'high';
  action: AiAction;
  verification: string[];
  evidence: string[];
}

export interface AiPlanResponse {
  planner: 'ai';
  model: string;
  inspected: { name: string; totalFiles: number; truncated: boolean };
  summary: string;
  steps: AiPlanStep[];
  assumptions: string[];
  unknowns: string[];
}

export interface DeterministicPlanResponse {
  planner: 'deterministic';
  reason: string;
  inspected?: { name: string; totalFiles: number; truncated: boolean };
}

export type PlanRequestFailure =
  | 'request_failed'
  | 'rate_limited'
  | 'invalid_response';

export type PlanRequestResult =
  | { ok: true; response: AiPlanResponse | DeterministicPlanResponse }
  | { ok: false; reason: PlanRequestFailure };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const ACTION_TYPES = new Set(['read', 'check', 'edit', 'report', 'manual']);
const PROVIDERS = new Set(['local', 'external', 'none']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isAiStep(value: unknown): value is AiPlanStep {
  if (!isRecord(value) || !isRecord(value.action)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    typeof value.risk === 'string' &&
    ACTION_TYPES.has(value.action.type as string) &&
    isStringArray(value.dependsOn) &&
    isStringArray(value.verification) &&
    isStringArray(value.evidence)
  );
}

function isPlanResponse(value: unknown): value is AiPlanResponse | DeterministicPlanResponse {
  if (!isRecord(value)) {
    return false;
  }

  if (value.planner === 'deterministic') {
    return typeof value.reason === 'string';
  }

  if (value.planner !== 'ai') {
    return false;
  }

  return (
    typeof value.model === 'string' &&
    typeof value.summary === 'string' &&
    isStringArray(value.assumptions) &&
    isStringArray(value.unknowns) &&
    Array.isArray(value.steps) &&
    value.steps.length > 0 &&
    value.steps.every(isAiStep) &&
    isRecord(value.inspected)
  );
}

function isPlannerConfig(value: unknown): value is PlannerConfig {
  return (
    isRecord(value) &&
    typeof value.available === 'boolean' &&
    typeof value.provider === 'string' &&
    PROVIDERS.has(value.provider) &&
    (value.model === undefined || typeof value.model === 'string')
  );
}

async function withTimeout<T>(
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('planner_timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function fetchPlannerConfig(
  fetchImpl: FetchLike = fetch,
  timeoutMs = 5_000,
): Promise<PlannerConfig | null> {
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      const response = await fetchImpl('/api/plan/config', {
        headers: evidenceHeaders({ Accept: 'application/json' }),
        signal,
      });

      if (!response.ok) {
        return null;
      }

      const payload: unknown = await response.json().catch(() => null);
      if (!isPlannerConfig(payload)) {
        return null;
      }

      return {
        available: payload.available,
        provider: payload.provider,
        ...(payload.model ? { model: payload.model } : {}),
      };
    });
  } catch {
    return null;
  }
}

export async function requestPlan(
  input: { root: string; brief: string },
  fetchImpl: FetchLike = fetch,
  timeoutMs = 30_000,
): Promise<PlanRequestResult> {
  try {
    return await withTimeout(timeoutMs, async (signal) => {
      const response = await fetchImpl('/api/plan', {
        method: 'POST',
        headers: evidenceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ root: input.root, brief: input.brief }),
        signal,
      });

      if (response.status === 429) {
        return { ok: false, reason: 'rate_limited' } as const;
      }

      if (!response.ok) {
        return { ok: false, reason: 'request_failed' } as const;
      }

      const payload: unknown = await response.json().catch(() => null);
      return isPlanResponse(payload)
        ? ({ ok: true, response: payload } as const)
        : ({ ok: false, reason: 'invalid_response' } as const);
    });
  } catch {
    return { ok: false, reason: 'request_failed' };
  }
}

/**
 * Prevents duplicate concurrent submissions while a plan is being generated.
 * Returns null for a duplicate call.
 */
export function createSingleFlight() {
  let inFlight = false;

  return async function run<T>(task: () => Promise<T>): Promise<T | null> {
    if (inFlight) {
      return null;
    }

    inFlight = true;

    try {
      return await task();
    } finally {
      inFlight = false;
    }
  };
}