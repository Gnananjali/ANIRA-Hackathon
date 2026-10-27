import { Router } from 'express';

import { PlannerError, type PlannerService } from '../planner/service';
import { failureInput, recordEvidence } from '../evidence/recorder';
import type { EvidenceInput, EvidenceRecorder } from '../evidence/schema';
import { evidenceSession } from '../evidence/session';
import { passesOriginGuard } from './guard';

function planningEvent(
  response: Awaited<ReturnType<PlannerService['plan']>>,
): EvidenceInput {
  const inspected =
    response.inspected === undefined
      ? undefined
      : {
          totalFiles: response.inspected.totalFiles,
          truncated: response.inspected.truncated,
        };

  if (response.planner === 'ai') {
    return {
      type: 'planning',
      outcome: 'planned',
      operation: 'planner.plan',
      evidence: {
        kind: 'planning',
        planner: 'ai',
        model: response.model,
        stepCount: response.steps.length,
        steps: response.steps.map((step) => ({
          id: step.id,
          action: step.action.type,
          risk: step.risk,
        })),
        ...(inspected ? { inspected } : {}),
      },
    };
  }

  return {
    type: 'planning',
    outcome: 'planned',
    operation: 'planner.plan',
    reason: response.reason,
    evidence: {
      kind: 'planning',
      planner: 'deterministic',
      fallbackReason: response.reason,
      stepCount: 0,
      steps: [],
      ...(inspected ? { inspected } : {}),
    },
  };
}

export function createPlanRouter(
  service: PlannerService,
  evidence?: EvidenceRecorder,
) {
  const router = Router();

  router.get('/plan/config', (request, response) => {
    const guard = passesOriginGuard(request.get('origin'));
    if (!guard.ok) {
      response.status(403).json({ error: guard.code });
      return;
    }

    response.json(service.status());
  });

  router.post('/plan', async (request, response, next) => {
    const sessionId = evidenceSession(request);
    const guard = passesOriginGuard(request.get('origin'));
    if (!guard.ok) {
      recordEvidence(
        evidence,
        sessionId,
        failureInput('planner.plan', 'blocked', guard.code),
      );
      response.status(403).json({ error: guard.code });
      return;
    }

    try {
      const body = (request.body ?? {}) as { root?: unknown; brief?: unknown };
      const result = await service.plan({ root: body.root, brief: body.brief });
      recordEvidence(evidence, sessionId, planningEvent(result));
      response.json(result);
    } catch (error) {
      if (error instanceof PlannerError) {
        recordEvidence(
          evidence,
          sessionId,
          failureInput(
            'planner.plan',
            error.status === 400 ? 'failed' : 'blocked',
            error.code,
          ),
        );

        if (error.retryAfterMs) {
          response.setHeader(
            'Retry-After',
            String(Math.ceil(error.retryAfterMs / 1000)),
          );
        }

        response.status(error.status).json({
          error: error.code,
          ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}),
        });
        return;
      }

      recordEvidence(
        evidence,
        sessionId,
        failureInput('planner.plan', 'failed', 'internal_error'),
      );
      next(error);
    }
  });

  return router;
}