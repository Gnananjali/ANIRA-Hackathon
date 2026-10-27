import cors from 'cors';
import express from 'express';
import type { ErrorRequestHandler } from 'express';

import { healthRouter } from './routes/health';
import { inspectRouter } from './routes/inspect';
import { createCheckRouter } from './routes/checks';
import { createCheckService, type CheckService } from './checks/service';

interface RequestError extends Error {
  status?: number;
  type?: string;
}

/**
 * Converts body-parser and unexpected failures into small JSON bodies.
 * Stack traces, file paths and upstream messages never reach the client.
 */
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestError = error as RequestError;

  if (requestError.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }

  if (requestError.type === 'entity.too.large') {
    res.status(413).json({ error: 'payload_too_large' });
    return;
  }

  console.error('[anira] unhandled request error');
  res.status(500).json({ error: 'internal_error' });
};

export interface AppOptions {
  checkService?: CheckService;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const checkService = options.checkService ?? createCheckService();

  app.disable('x-powered-by');
  app.use(
    cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    }),
  );
  app.use(express.json({ limit: '64kb' }));

  app.use('/api', healthRouter);
  app.use('/api', inspectRouter);
  app.use('/api', createCheckRouter(checkService));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use(errorHandler);

  return app;
}