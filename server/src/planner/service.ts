import { inspectTestScript } from '../checks/catalog';
import { inspectRepository, type InspectionResult } from '../services/inspectRepository';
import { derivePlanConstraints } from './constraints';
import { buildPlanningPrompt } from './prompt';
import {
  createOpenAiCompatibleClient,
  loadProviderConfig,
  type ModelClient,
} from './provider';
import { buildPathIndex, validatePlan, type PlannedStep } from './schema';

export type PlannerFallbackReason =
  | 'no_api_key'
  | 'no_inspection'
  | 'timeout'
  | 'model_error'
  | 'invalid_output'
  | 'unsafe_plan';

export interface InspectedSummary {
  name: string;
  totalFiles: number;
  truncated: boolean;
}

export type PlannerResponse =
  | {
      planner: 'ai';
      model: string;
      inspected: InspectedSummary;
      summary: string;
      steps: PlannedStep[];
      assumptions: string[];
      unknowns: string[];
    }
  | {
      planner: 'deterministic';
      reason: PlannerFallbackReason;
      inspected?: InspectedSummary;
    };

export type PlannerProvider = 'local' | 'external' | 'none';

export interface PlannerStatus {
  available: boolean;
  provider: PlannerProvider;
  model?: string;
}

export interface PlannerRateLimit {
  maxRequests: number;
  windowMs: number;
}

export interface PlannerServiceOptions {
  client?: ModelClient | null;
  providerInfo?: { provider: 'local' | 'external'; model: string } | null;
  timeoutMs?: number;
  rateLimit?: PlannerRateLimit;
  now?: () => number;
  inspect?: (root: unknown) => Promise<InspectionResult>;
}

export function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

export class PlannerError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'PlannerError';
  }
}

function parseModelJson(
  text: string,
): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

function inspectedSummary(inspection: InspectionResult): InspectedSummary {
  return {
    name: inspection.name,
    totalFiles: inspection.totalFiles,
    truncated: inspection.truncated,
  };
}

export function createPlannerService(options: PlannerServiceOptions = {}) {
  const config = loadProviderConfig();
  const client =
    options.client !== undefined
      ? options.client
      : config
        ? createOpenAiCompatibleClient(config)
        : null;
  const timeoutMs = options.timeoutMs ?? config?.timeoutMs ?? 20_000;
  const rateLimit = options.rateLimit ?? { maxRequests: 6, windowMs: 60_000 };
  const now = options.now ?? Date.now;
  const inspect = options.inspect ?? inspectRepository;

  const providerInfo =
    options.providerInfo !== undefined
      ? options.providerInfo
      : config
        ? {
            provider: isLoopbackBaseUrl(config.baseUrl)
              ? ('local' as const)
              : ('external' as const),
            model: config.model,
          }
        : client
          ? { provider: 'external' as const, model: client.model }
          : null;

  const timestamps: number[] = [];
  let active = false;

  function fallback(
    reason: PlannerFallbackReason,
    inspection?: InspectionResult,
  ): PlannerResponse {
    return {
      planner: 'deterministic',
      reason,
      ...(inspection ? { inspected: inspectedSummary(inspection) } : {}),
    };
  }

  function checkRateLimit(): void {
    const current = now();
    while (timestamps.length > 0 && timestamps[0] <= current - rateLimit.windowMs) {
      timestamps.shift();
    }

    if (timestamps.length >= rateLimit.maxRequests) {
      const retryAfterMs = Math.max(
        1,
        rateLimit.windowMs - (current - timestamps[0]),
      );
      throw new PlannerError('plan_rate_limited', 429, retryAfterMs);
    }
  }

  return {
    status(): PlannerStatus {
      if (!client) {
        return { available: false, provider: 'none' };
      }

      return {
        available: true,
        provider: providerInfo?.provider ?? 'external',
        ...(providerInfo?.model ?? client.model
          ? { model: providerInfo?.model ?? client.model }
          : {}),
      };
    },

    async plan(input: { root: unknown; brief: unknown }): Promise<PlannerResponse> {
      if (typeof input.brief !== 'string') {
        throw new PlannerError('invalid_request', 400);
      }

      const brief = input.brief.trim();
      if (brief.length === 0 || brief.length > 4_000) {
        throw new PlannerError('invalid_request', 400);
      }

      if (!client) {
        return fallback('no_api_key');
      }

      if (active) {
        throw new PlannerError('plan_in_progress', 409);
      }

      checkRateLimit();
      active = true;
      timestamps.push(now());

      try {
        let inspection: InspectionResult;
        try {
          inspection = await inspect(input.root);
        } catch {
          return fallback('no_inspection');
        }

        const constraints = derivePlanConstraints(brief);
        const testScriptAvailable =
          (await inspectTestScript(inspection.root)) === 'ready';
        const { system, user } = buildPlanningPrompt({
          brief,
          constraints,
          inspection,
        });

        const controller = new AbortController();
        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error('planner_timeout'));
          }, timeoutMs);
        });

        let content: string;

        try {
          content = await Promise.race([
            client.complete({ system, user, signal: controller.signal }),
            timeoutPromise,
          ]);
        } catch {
          return fallback(timedOut ? 'timeout' : 'model_error', inspection);
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
        }

        const parsed = parseModelJson(content);
        if (!parsed.ok) {
          return fallback('invalid_output', inspection);
        }

        const validation = validatePlan(parsed.value, {
          paths: buildPathIndex(inspection.files),
          constraints,
          testScriptAvailable,
        });

        if (!validation.ok) {
          return fallback(validation.code, inspection);
        }

        return {
          planner: 'ai',
          model: client.model,
          inspected: inspectedSummary(inspection),
          summary: validation.plan.summary,
          steps: validation.plan.steps,
          assumptions: validation.plan.assumptions,
          unknowns: validation.plan.unknowns,
        };
      } finally {
        active = false;
      }
    },
  };
}

export type PlannerService = ReturnType<typeof createPlannerService>;