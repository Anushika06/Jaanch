import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createRuntime, type Runtime } from '../src/runtime.js';

export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATA_DIR: ':memory:',
  SOURCE_MODE: 'fixture',
  LLM_PROVIDER: 'none',
  RDAP_LOOKUPS: 'false',
  INGEST_ON_BOOT: 'never',
  PUBLIC_BASE_URL: 'https://jaanch.test',
  APP_SECRET: 'test-secret-test-secret-test-secret-1234',
  WHATSAPP_COLLECT_WINDOW_MS: '50',
  TWILIO_MIN_SEND_INTERVAL_MS: '0',
  TWILIO_CATCHUP_ON_BOOT: 'false',
  SERVE_WEB: 'false',
} as const;

export async function startTestServer(
  overrides: Record<string, string> = {},
): Promise<{ rt: Runtime; app: FastifyInstance; close: () => Promise<void> }> {
  const config = loadConfig({ ...TEST_ENV, ...overrides } as NodeJS.ProcessEnv);
  const rt = await createRuntime(config, createLogger('silent', false));
  const app = await buildApp(rt);
  await app.ready();
  await rt.worker.start();
  return {
    rt,
    app,
    close: async () => {
      await app.close();
      await rt.close();
    },
  };
}

export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 10_000,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}
