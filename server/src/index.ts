import { createApp } from './app';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4000;

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const host = process.env.HOST?.trim() || DEFAULT_HOST;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[anira] invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

const app = createApp();

const server = app.listen(port, host, () => {
  console.log(`[anira] API listening on http://${host}:${port}`);
  console.log(
    `[anira] loopback-only by default; set HOST=0.0.0.0 to expose the API`,
  );
  console.log('[anira] scaffold mode: execution, models, voice and desktop control are disabled');
});

server.on('error', (error) => {
  console.error(`[anira] failed to start API on ${host}:${port}: ${error.message}`);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}