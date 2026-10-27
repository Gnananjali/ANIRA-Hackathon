import { Router } from 'express';

import { CheckError } from '../checks/catalog';
import type { CheckService } from '../checks/service';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

/**
 * The custom header forces a CORS preflight for browser callers, so a
 * cross-site page cannot trigger a run with a simple form POST. The explicit
 * origin check covers non-preflighted cases and non-browser clients that do
 * send an Origin header.
 */
function passesApprovalGuard(
  origin: string | undefined,
  header: string | undefined,
): { ok: true } | { ok: false; code: string } {
  if (header !== '1') {
    return { ok: false, code: 'approval_header_required' };
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return { ok: false, code: 'origin_not_allowed' };
  }

  return { ok: true };
}

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

export function createCheckRouter(service: CheckService) {
  const router = Router();

  router.post('/checks/prepare', async (request, response, next) => {
    const guard = passesApprovalGuard(
      request.get('origin'),
      request.get('x-anira-approval'),
    );
    if (!guard.ok) {
      response.status(403).json({ error: guard.code });
      return;
    }

    try {
      const body = (request.body ?? {}) as {
        root?: unknown;
        checkId?: unknown;
      };

      response.json(
        await service.prepare({ root: body.root, checkId: body.checkId }),
      );
    } catch (error) {
      if (!sendCheckError(response, error)) {
        next(error);
      }
    }
  });

  router.post('/checks/run', async (request, response, next) => {
    const guard = passesApprovalGuard(
      request.get('origin'),
      request.get('x-anira-approval'),
    );
    if (!guard.ok) {
      response.status(403).json({ error: guard.code });
      return;
    }

    try {
      const body = (request.body ?? {}) as { approvalId?: unknown };
      response.json(await service.run(body.approvalId));
    } catch (error) {
      if (!sendCheckError(response, error)) {
        next(error);
      }
    }
  });

  return router;
}