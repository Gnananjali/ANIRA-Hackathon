import { Router } from 'express';

import { CheckError } from '../checks/catalog';
import type { CheckService } from '../checks/service';
import { failureInput, recordEvidence } from '../evidence/recorder';
import type { EvidenceRecorder } from '../evidence/schema';
import { evidenceSession } from '../evidence/session';
import { passesApprovalGuard } from './guard';

function sendCheckError(
  response: import('express').Response,
  error: unknown,
): boolean {
  if (!(error instanceof CheckError)) {
    return false;
  }

  response.status(error.status).json({
    error: error.code,
    ...(error.reason ? { reason: error.reason } : {}),
  });
  return true;
}

export function createCheckRouter(
  service: CheckService,
  evidence?: EvidenceRecorder,
) {
  const router = Router();

  router.post('/checks/prepare', async (request, response, next) => {
    const sessionId = evidenceSession(request);
    const guard = passesApprovalGuard(
      request.get('origin'),
      request.get('x-anira-approval'),
    );
    if (!guard.ok) {
      recordEvidence(
        evidence,
        sessionId,
        failureInput('checks.prepare', 'blocked', guard.code),
      );
      response.status(403).json({ error: guard.code });
      return;
    }

    try {
      const body = (request.body ?? {}) as {
        root?: unknown;
        checkId?: unknown;
      };

      response.json(
        await service.prepare({
          root: body.root,
          checkId: body.checkId,
          sessionId,
        }),
      );
    } catch (error) {
      if (!sendCheckError(response, error)) {
        recordEvidence(
          evidence,
          sessionId,
          failureInput('checks.prepare', 'failed', 'internal_error'),
        );
        next(error);
      }
    }
  });

  router.post('/checks/run', async (request, response, next) => {
    const sessionId = evidenceSession(request);
    const guard = passesApprovalGuard(
      request.get('origin'),
      request.get('x-anira-approval'),
    );
    if (!guard.ok) {
      recordEvidence(
        evidence,
        sessionId,
        failureInput('checks.run', 'blocked', guard.code),
      );
      response.status(403).json({ error: guard.code });
      return;
    }

    try {
      const body = (request.body ?? {}) as { approvalId?: unknown };
      response.json(await service.run(body.approvalId, sessionId));
    } catch (error) {
      if (!sendCheckError(response, error)) {
        recordEvidence(
          evidence,
          sessionId,
          failureInput('checks.run', 'failed', 'internal_error'),
        );
        next(error);
      }
    }
  });

  return router;
}