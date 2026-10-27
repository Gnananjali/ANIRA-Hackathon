import { Router } from 'express';

import { InspectError, inspectRepository } from '../services/inspectRepository';
import { recordEvidence, failureInput } from '../evidence/recorder';
import type { EvidenceRecorder } from '../evidence/schema';
import { evidenceSession } from '../evidence/session';

export function createInspectRouter(evidence?: EvidenceRecorder) {
  const router = Router();

  router.post('/inspect', async (request, response, next) => {
    const sessionId = evidenceSession(request);

    try {
      const body = request.body as { path?: unknown } | undefined;
      const result = await inspectRepository(body?.path);

      recordEvidence(evidence, sessionId, {
        type: 'inspection',
        outcome: 'executed',
        operation: 'inspection.scan',
        evidence: {
          kind: 'inspection',
          repoName: result.name.split(/[\\/]/).pop() || result.name,
          totalFiles: result.totalFiles,
          truncated: result.truncated,
          ignoredFolders: result.ignored,
          stack: result.stack.map((signal) => signal.name),
          languages: result.languages.map((language) => ({
            name: language.name,
            files: language.files,
          })),
        },
      });

      response.json(result);
    } catch (error) {
      if (error instanceof InspectError) {
        recordEvidence(
          evidence,
          sessionId,
          failureInput(
            'inspection.scan',
            error.status === 403 ? 'blocked' : 'failed',
            error.code,
          ),
        );
        response.status(error.status).json({ error: error.code });
        return;
      }

      recordEvidence(
        evidence,
        sessionId,
        failureInput('inspection.scan', 'failed', 'internal_error'),
      );
      next(error);
    }
  });

  return router;
}