import { Router } from 'express';

import { InspectError, inspectRepository } from '../services/inspectRepository';

export const inspectRouter = Router();

inspectRouter.post('/inspect', async (request, response, next) => {
  try {
    const body = request.body as { path?: unknown } | undefined;
    const result = await inspectRepository(body?.path);
    response.json(result);
  } catch (error) {
    if (error instanceof InspectError) {
      response.status(error.status).json({ error: error.code });
      return;
    }

    next(error);
  }
});