import { Router } from 'express';
import type { Response } from 'express';

import { EditError } from '../edits/path';
import type { EditService } from '../edits/service';
import { failureInput, recordEvidence } from '../evidence/recorder';
import type { EvidenceRecorder } from '../evidence/schema';
import { evidenceSession } from '../evidence/session';
import { passesApprovalGuard } from './guard';

function sendEditError(response: Response, error: unknown): boolean {
  if (!(error instanceof EditError)) {
    return false;
  }

  response.status(error.status).json({
    error: error.code,
    ...(error.reason ? { reason: error.reason } : {}),
  });
  return true;
}

export function createEditRouter(
  service: EditService,
  evidence?: EvidenceRecorder,
) {
  const router = Router();

  router.post('/edits/prepare', async (request, response, next) => {
    const sessionId = evidenceSession(request);
    const guard = passesApprovalGuard(
      request.get('origin'),
      request.get('x-anira-approval'),
    );
    if (!guard.ok) {
      recordEvidence(
        evidence,
        sessionId,
        failureInput('edits.prepare', 'blocked', guard.code),
      );
      response.status(403).json({ error: guard.code });
      return;
    }

    try {
      const body = (request.body ?? {}) as {
        root?: unknown;
        path?: unknown;
        find?: unknown;
        replace?: unknown;
      };

      response.json(
        await service.prepare({
          root: body.root,
          path: body.path,
          find: body.find,
          replace: body.replace,
          sessionId,
        }),
      );
    } catch (error) {
      if (!sendEditError(response, error)) {
        recordEvidence(
          evidence,
          sessionId,
          failureInput('edits.prepare', 'failed', 'internal_error'),
        );
        next(error);
      }
    }
  });

  router.post('/edits/apply', async (request, response, next) => {
    const sessionId = evidenceSession(request);
    const guard = passesApprovalGuard(
      request.get('origin'),
      request.get('x-anira-approval'),
    );
    if (!guard.ok) {
      recordEvidence(
        evidence,
        sessionId,
        failureInput('edits.apply', 'blocked', guard.code),
      );
      response.status(403).json({ error: guard.code });
      return;
    }

    try {
      const body = (request.body ?? {}) as { editId?: unknown };
      response.json(await service.apply(body.editId, sessionId));
    } catch (error) {
      if (!sendEditError(response, error)) {
        recordEvidence(
          evidence,
          sessionId,
          failureInput('edits.apply', 'failed', 'internal_error'),
        );
        next(error);
      }
    }
  });

  router.post('/edits/rollback', async (request, response, next) => {
    const sessionId = evidenceSession(request);
    const guard = passesApprovalGuard(
      request.get('origin'),
      request.get('x-anira-approval'),
    );
    if (!guard.ok) {
      recordEvidence(
        evidence,
        sessionId,
        failureInput('edits.rollback', 'blocked', guard.code),
      );
      response.status(403).json({ error: guard.code });
      return;
    }

    try {
      const body = (request.body ?? {}) as { rollbackId?: unknown };
      response.json(await service.rollback(body.rollbackId, sessionId));
    } catch (error) {
      if (!sendEditError(response, error)) {
        recordEvidence(
          evidence,
          sessionId,
          failureInput('edits.rollback', 'failed', 'internal_error'),
        );
        next(error);
      }
    }
  });

  return router;
}