import { Router } from 'express';

import { evidenceSession } from '../evidence/session';
import type { EvidenceStore } from '../evidence/store';
import { passesOriginGuard } from './guard';

export function createEvidenceRouter(store: EvidenceStore) {
  const router = Router();

  router.get('/evidence', (request, response) => {
    const guard = passesOriginGuard(request.get('origin'));
    if (!guard.ok) {
      response.status(403).json({ error: guard.code });
      return;
    }

    const sessionId = evidenceSession(request);
    response.setHeader('Cache-Control', 'no-store');
    response.json({
      sessionId,
      events: store.list(sessionId),
      limits: store.limits,
      persistence: 'memory-only',
      note: store.note,
    });
  });

  // The timeline is proof, not a client-authored log. There is deliberately no
  // endpoint that accepts events.
  router.all('/evidence', (_request, response) => {
    response.status(405).json({ error: 'evidence_is_read_only' });
  });

  return router;
}