import { Router } from 'express';

export const healthRouter = Router();

/**
 * Liveness probe for the ANIRA scaffold.
 *
 * `capabilities` is intentionally reported as all-false: this milestone has no
 * model calls, voice input, desktop control, or command execution.
 */
healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'anira-server',
    mode: 'scaffold',
    version: '0.1.0',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    capabilities: {
      execution: false,
      llm: false,
      voice: false,
      desktopControl: false,
    },
  });
});