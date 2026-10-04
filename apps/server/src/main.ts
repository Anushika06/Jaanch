import { catchUpInbound } from './channels/whatsapp/routes.js';
import { buildApp } from './app.js';
import { ConfigError, describeConfig, loadConfig } from './config.js';
import { loadEnvFile } from './env.js';
import { createLogger } from './logger.js';
import { createRuntime, SWEEP_JOB } from './runtime.js';
import { ingestOnBootIfNeeded } from './services/ingestion.js';

const SWEEP_INTERVAL_MS = 6 * 3_600_000;

async function main(): Promise<void> {
  const envFile = loadEnvFile();
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  }
  const logger = createLogger(
    config.LOG_LEVEL,
    config.NODE_ENV === 'development' && process.stdout.isTTY,
  );
  logger.info(
    { ...describeConfig(config), envFile: envFile ? 'loaded' : 'none' },
    'starting Jaanch',
  );

  const rt = await createRuntime(config, logger);
  const app = await buildApp(rt);
  await app.listen({ host: config.HOST, port: config.PORT });

  if (config.WORKER_ENABLED) await rt.worker.start();

  // Background start-up tasks; failures are logged, never fatal.
  void (async () => {
    try {
      await rt.repos.jobs.enqueue(
        SWEEP_JOB,
        {},
        { dedupeKey: 'sweep', runAt: new Date(Date.now() + 60_000) },
      );
      rt.worker.poke();
      if (rt.llm) {
        // Hosted models are retired regularly; say so loudly instead of failing per request.
        const statuses = await rt.llm.checkModels();
        for (const [model, status] of Object.entries(statuses)) {
          if (status === 'live') logger.info({ model }, 'language model available');
          else
            logger.warn(
              { model, status },
              'configured language model is not available; set LLM_*_MODEL to a live model',
            );
        }
      }
      if (rt.transport && rt.conversation && config.TWILIO_CATCHUP_ON_BOOT) {
        await catchUpInbound(
          {
            transport: rt.transport,
            conversation: rt.conversation,
            inbound: rt.repos.inbound,
            logger,
          },
          6 * 3_600_000,
        );
      }
      await ingestOnBootIfNeeded(rt);
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'start-up task failed',
      );
    }
  })();

  // Periodic sweep, scheduled through the queue so it also runs if this process restarts.
  const sweepTimer = setInterval(() => {
    void rt.repos.jobs.enqueue(SWEEP_JOB, {}, { dedupeKey: 'sweep' }).then(() => rt.worker.poke());
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(sweepTimer);
    await app.close().catch(() => undefined);
    await rt.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('fatal start-up error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
