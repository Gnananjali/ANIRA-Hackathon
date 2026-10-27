import type {
  PlanActionType,
  PlanReport,
  PlanStep,
  StepKind,
} from './types';
import type { AiPlanResponse, AiPlanStep, PlannerProvider } from './plannerClient';

const TOOL_BY_ACTION: Record<PlanActionType, string> = {
  read: 'filesystem.read',
  check: 'checks.run',
  edit: 'workspace.patch',
  report: 'report.compose',
  manual: 'human.review',
};

const KIND_BY_ACTION: Record<PlanActionType, StepKind> = {
  read: 'read',
  check: 'execute',
  edit: 'write',
  report: 'read',
  manual: 'read',
};

const FALLBACK_LABELS: Record<string, string> = {
  no_api_key: 'No AI provider configured',
  no_inspection: 'No repository scan',
  timeout: 'AI planner timed out',
  model_error: 'AI provider failed',
  invalid_output: 'AI output was rejected',
  unsafe_plan: 'AI plan was rejected as unsafe',
  request_failed: 'Planner request failed',
  rate_limited: 'Planner rate limited',
  invalid_response: 'Planner returned an invalid response',
  user_declined_external: 'You chose the local planner',
  planner_unavailable: 'Planner status unavailable',
};

export function fallbackLabel(reason?: string): string {
  if (!reason) {
    return 'AI planner unavailable';
  }

  return FALLBACK_LABELS[reason] ?? 'AI planner unavailable';
}

function actionType(step: AiPlanStep): PlanActionType {
  const type = step.action.type;
  return type === 'read' ||
    type === 'check' ||
    type === 'edit' ||
    type === 'report' ||
    type === 'manual'
    ? type
    : 'manual';
}

export function mapAiSteps(steps: AiPlanStep[]): PlanStep[] {
  return steps.map((step) => {
    const type = actionType(step);

    return {
      id: step.id,
      title: step.title,
      detail: step.description,
      tool: TOOL_BY_ACTION[type],
      risk: step.risk,
      status: 'proposed',
      kind: KIND_BY_ACTION[type],
      actionType: type,
      dependsOn: [...step.dependsOn],
      verification: [...step.verification],
      evidence: [...step.evidence],
    };
  });
}

export function buildAiReport(
  base: PlanReport,
  response: AiPlanResponse,
  provider?: PlannerProvider,
): PlanReport {
  return {
    ...base,
    planner: 'ai',
    plannerReason: undefined,
    plannerModel: response.model,
    provider,
    summary: response.summary,
    assumptions: [...response.assumptions],
    unknowns: [...response.unknowns],
    steps: mapAiSteps(response.steps),
  };
}

export function buildFallbackReport(
  base: PlanReport,
  reason: string,
): PlanReport {
  return {
    ...base,
    planner: 'deterministic',
    plannerReason: reason,
    plannerModel: undefined,
    provider: undefined,
    summary: undefined,
    assumptions: [],
    unknowns: [],
  };
}